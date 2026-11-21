import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import express from 'express';
import { getDb } from '../server/db/schema.ts';
import { ACME_TEAM_ID, DEMO_USERS, MEETING_3_SAMPLE, seedDemoWorkspace } from '../server/db/seed.ts';
import { parseTranscript } from '../server/utils/transcriptParser.ts';
import { runDeterministicConflictChecks } from '../server/agents/conflict-agent.ts';
import { handleHumanApproval, processMeetingPipeline } from '../server/agents/approval-service.ts';
import {
  extractParticipantsFromSegments,
  resolveOwnerIdentity,
  resolveTeamMember,
  runMeetingUnderstandingAgent,
} from '../server/agents/meeting-agent.ts';
import {
  GeminiUnavailableError,
  generateContentResilient,
  getGeminiFallbackStatus,
  resetGeminiFallbackState,
  runWithGeminiContext,
  type GeminiClientLike,
} from '../server/ai/client.ts';
import { executeApprovedActionToGitHub, GovernanceError } from '../server/agents/execution-agent.ts';
import { evaluateReminders } from '../server/agents/followup-agent.ts';
import { generateWeeklyDigestForUser } from '../server/agents/digest-agent.ts';
import { getStructuredActions, getStructuredDecisions, getStructuredDependencies } from '../server/memory/retrieval.ts';
import { ConflictJudgmentSchema, MeetingExtractionSchema } from '../server/validation/schemas.ts';
import { createApiRouter } from '../server/routes/api.ts';
import type { Decision } from '../src/types/decisionflow.ts';

function setupTestDb() {
  const db = getDb(':memory:');
  seedDemoWorkspace(db);
  return db;
}

test('Transcript parser preserves speaker attribution and sequence order', () => {
  const segments = parseTranscript(MEETING_3_SAMPLE.transcript);
  assert.equal(segments.length, 6);
  assert.equal(segments[0].speakerName, 'Priya');
  assert.equal(segments[0].sequenceNumber, 1);
  assert.equal(segments[1].speakerName, 'Rahul');
  assert.match(segments[1].text, /December 5/);
  assert.equal(segments[3].speakerName, 'Ananya');
  assert.match(segments[3].text, /December 8/);
});

test('Seeded workspace contains Meeting 1 (Dec 10), Meeting 2 (Dec 8), and dependency', () => {
  const db = setupTestDb();
  const decisions = getStructuredDecisions(db, ACME_TEAM_ID);
  const actions = getStructuredActions(db, ACME_TEAM_ID);
  const deps = getStructuredDependencies(db, ACME_TEAM_ID);

  const activeLaunch = decisions.find((d) => d.status === 'ACTIVE' && d.topic === 'Payment launch');
  assert.ok(activeLaunch, 'Active Dec 10 Payment launch decision must exist');
  assert.equal(activeLaunch.effective_date, '2026-12-10');

  const apiDocs = actions.find((a) => a.title.includes('payment API documentation'));
  assert.ok(apiDocs, 'API docs action must exist');
  assert.equal(apiDocs.due_date, '2026-11-25');

  const secCert = actions.find((a) => a.title.includes('security certification'));
  assert.ok(secCert, 'Security certification action must exist');
  assert.equal(secCert.due_date, '2026-12-08');

  assert.equal(deps.length, 1);
  assert.equal(deps[0].relationship, 'MUST_HAPPEN_BEFORE');
  assert.equal(deps[0].source_id, secCert.id);
  assert.equal(deps[0].target_id, activeLaunch.id);
  db.close();
});

test('Deterministic conflict check detects Dec 5 launch preceding Dec 8 security certification dependency', () => {
  const db = setupTestDb();
  const activeDecisions = getStructuredDecisions(db, ACME_TEAM_ID).filter((d) => d.status === 'ACTIVE');
  const actions = getStructuredActions(db, ACME_TEAM_ID);
  const deps = getStructuredDependencies(db, ACME_TEAM_ID);

  const proposedDec5: Decision = {
    id: randomUUID(),
    team_id: ACME_TEAM_ID,
    meeting_id: '33333333-3333-3333-3333-333333333301',
    topic: 'Payment launch',
    decision_text: 'Move payment launch to December 5, 2026',
    status: 'PROPOSED',
    owner_id: DEMO_USERS[0].id,
    rationale: 'Accelerate launch',
    effective_date: '2026-12-05',
    source_segment_id: null,
    supersedes_decision_id: null,
    is_proposal: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const findings = runDeterministicConflictChecks({
    proposedDecision: proposedDec5,
    activeDecisions,
    actionItems: actions,
    dependencies: deps,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].conflictType, 'DEPENDENCY_CONFLICT');
  assert.equal(findings[0].severity, 'HIGH');
  assert.match(findings[0].explanation, /2026-12-05/);
  assert.match(findings[0].explanation, /2026-12-08/);
  db.close();
});

test('Human approval supersedes Dec 10 decision, promotes Dec 5 to ACTIVE, and preserves lineage', async () => {
  const db = setupTestDb();
  const meeting3Id = randomUUID();
  const dec5Id = randomUUID();
  const approvalId = randomUUID();

  db.prepare(
    `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, raw_transcript, processing_status)
     VALUES (?, ?, 'Payment Launch Review', '2026-11-21', 'PASTE', ?, 'PROCESSED')`
  ).run(meeting3Id, ACME_TEAM_ID, MEETING_3_SAMPLE.transcript);

  db.prepare(
    `INSERT INTO decisions (id, team_id, meeting_id, topic, decision_text, status, owner_id, effective_date, is_proposal)
     VALUES (?, ?, ?, 'Payment launch', 'Move payment launch to December 5, 2026', 'PROPOSED', ?, '2026-12-05', 0)`
  ).run(dec5Id, ACME_TEAM_ID, meeting3Id, DEMO_USERS[0].id);

  db.prepare(
    `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id)
     VALUES (?, ?, 1, 'Move payment launch to December 5, 2026', '2026-12-05', 'PROPOSED', ?)`
  ).run(randomUUID(), dec5Id, meeting3Id);

  db.prepare(
    `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, status)
     VALUES (?, ?, 'DECISION', ?, 'Payment launch: Move to Dec 5', 'PENDING')`
  ).run(approvalId, ACME_TEAM_ID, dec5Id);

  // Before approval: Dec 10 remains ACTIVE
  const beforeDec10 = db
    .prepare(`SELECT status FROM decisions WHERE id = '55555555-5555-5555-5555-555555555501'`)
    .get() as { status: string };
  assert.equal(beforeDec10.status, 'ACTIVE');

  const outcome = await handleHumanApproval(db, {
    approvalId,
    decision: 'APPROVE',
    reviewedBy: DEMO_USERS[0].id,
  });

  assert.equal(outcome.activatedDecisionId, dec5Id);
  assert.equal(outcome.supersededDecisionId, '55555555-5555-5555-5555-555555555501');

  // After approval: Dec 10 is SUPERSEDED and Dec 5 is ACTIVE
  const afterDec10 = db
    .prepare(`SELECT status FROM decisions WHERE id = '55555555-5555-5555-5555-555555555501'`)
    .get() as { status: string };
  const afterDec5 = db
    .prepare(`SELECT status, supersedes_decision_id FROM decisions WHERE id = ?`)
    .get(dec5Id) as { status: string; supersedes_decision_id: string };

  assert.equal(afterDec10.status, 'SUPERSEDED');
  assert.equal(afterDec5.status, 'ACTIVE');
  assert.equal(afterDec5.supersedes_decision_id, '55555555-5555-5555-5555-555555555501');

  // Dependent Dec 8 security certification flagged as affected
  assert.ok(outcome.affectedItems.some((i) => i.title.includes('security certification')));
  db.close();
});

test('Execution governance blocks GitHub issue creation without APPROVED status', async () => {
  const db = setupTestDb();
  const actionId = randomUUID();
  const approvalId = randomUUID();

  db.prepare(
    `INSERT INTO action_items (id, team_id, meeting_id, title, owner_id, due_date, priority, status)
     VALUES (?, ?, '33333333-3333-3333-3333-333333333301', 'Update launch checklist', ?, '2026-11-23', 'HIGH', 'PROPOSED')`
  ).run(actionId, ACME_TEAM_ID, DEMO_USERS[1].id);

  db.prepare(
    `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, status)
     VALUES (?, ?, 'ACTION_ITEM', ?, 'Update launch checklist', 'PENDING')`
  ).run(approvalId, ACME_TEAM_ID, actionId);

  await assert.rejects(
    () => executeApprovedActionToGitHub(db, { actionItemId: actionId, approvalId }),
    (err: unknown) => err instanceof GovernanceError && err.code === 'APPROVAL_NOT_GRANTED' && err.statusCode === 403
  );
  db.close();
});

test('Reminders detect UPCOMING_DEADLINE, AT_RISK, and OVERDUE accurately', () => {
  const db = setupTestDb();
  // On 2026-11-24: Nov 25 API doc task is 1 day away -> AT_RISK
  const remindersNov24 = evaluateReminders(db, ACME_TEAM_ID, '2026-11-24');
  const apiDocRem = remindersNov24.find((r) => r.action_title?.includes('API documentation'));
  assert.ok(apiDocRem);
  assert.equal(apiDocRem.reminder_type, 'AT_RISK');

  // On 2026-11-26: Nov 25 API doc task is 1 day past due -> OVERDUE
  const remindersNov26 = evaluateReminders(db, ACME_TEAM_ID, '2026-11-26');
  const overdueRem = remindersNov26.find(
    (r) => r.action_title?.includes('API documentation') && r.reminder_type === 'OVERDUE'
  );
  assert.ok(overdueRem);
  db.close();
});

test('Weekly digest reflects actual database state for Rahul', async () => {
  const db = setupTestDb();
  evaluateReminders(db, ACME_TEAM_ID, '2026-11-21');
  const digest = await generateWeeklyDigestForUser(db, {
    teamId: ACME_TEAM_ID,
    userId: DEMO_USERS[1].id,
    referenceDate: '2026-11-21',
  });

  assert.equal(digest.user_id, DEMO_USERS[1].id);
  assert.ok(digest.content.needsAttention.some((a) => a.title.includes('API documentation')));
  assert.ok(digest.content.decisionsAffectingYou.some((d) => d.topic === 'Payment launch'));
  db.close();
});

test('API router enforces validation and governance checks over HTTP', async () => {
  const db = setupTestDb();
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(db));

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Create meeting via POST /api/meetings
    const createRes = await fetch(`${baseUrl}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: MEETING_3_SAMPLE.title,
        meetingDate: MEETING_3_SAMPLE.meetingDate,
        sourceType: 'PASTE',
        transcript: MEETING_3_SAMPLE.transcript,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as { meeting: { id: string; processing_status: string } };
    assert.equal(createdJson.meeting.processing_status, 'UPLOADED');

    // 2. Governance check on /api/github/create-issue without approval
    const ghRes = await fetch(`${baseUrl}/api/github/create-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionItemId: 'nonexistent-action',
      }),
    });
    assert.equal(ghRes.status, 404);
  } finally {
    server.close();
    db.close();
  }
});

test('MeetingExtractionSchema validates normal action items without open_loop_reason and captures open loops when present', () => {
  const parsed = MeetingExtractionSchema.parse({
    summary: 'Team aligned on Q4 release tasks and QA milestones.',
    mentioned_people: ['Priya Sharma', 'Rahul Verma'],
    decisions: [
      {
        topic: 'Release window',
        decision_text: 'Keep the release freeze on December 4.',
        classification: 'CONFIRMED_DECISION',
        source_segment_sequence: 1,
        confidence: 0.94,
      },
      {
        topic: 'Rollout plan',
        decision_text: 'Stage rollout at 10% first.',
        classification: 'PROPOSAL',
        owner_name: null,
        effective_date: null,
        rationale: null,
        source_segment_sequence: 2,
        confidence: 0.78,
      },
    ],
    action_items: [
      {
        title: 'Publish deployment checklist',
        owner_name: 'Priya Sharma',
        owner_confirmed: true,
        due_date: '2026-12-02',
        priority: 'HIGH',
        is_open_loop: false,
        source_segment_sequence: 3,
      },
      {
        title: 'Finalize QA regression suite',
        description: null,
        owner_name: 'Rahul Verma',
        owner_confirmed: true,
        due_date: '2026-12-03',
        priority: 'MEDIUM',
        is_open_loop: false,
        open_loop_reason: null,
        source_segment_sequence: 4,
      },
      {
        title: 'Coordinate external launch email',
        description: 'Needs owner assignment before launch.',
        owner_name: null,
        owner_confirmed: false,
        due_date: null,
        priority: 'LOW',
        is_open_loop: true,
        open_loop_reason: 'Owner and send date were not confirmed in meeting',
        source_segment_sequence: 5,
      },
    ],
    dependencies: [],
    open_loops: [],
  });

  assert.equal(parsed.action_items.length, 3);
  assert.equal(parsed.action_items[0].open_loop_reason, undefined);
  assert.equal(parsed.action_items[0].source_segment_sequence, 3);
  assert.equal(parsed.action_items[1].open_loop_reason, null);
  assert.equal(parsed.action_items[2].is_open_loop, true);
  assert.equal(
    parsed.action_items[2].open_loop_reason,
    'Owner and send date were not confirmed in meeting'
  );
  assert.equal(parsed.decisions[0].owner_name, undefined);
  assert.equal(parsed.decisions[1].rationale, null);
});

test('ConflictJudgmentSchema accepts omitted or null existing_item_id and existing_item_type', () => {
  const omitted = ConflictJudgmentSchema.parse({
    has_conflict: false,
    conflict_type: 'NONE',
    severity: 'LOW',
    explanation: 'No conflict with historical organizational memory.',
    confidence: 0.91,
    requires_approval: false,
  });
  assert.equal(omitted.existing_item_id, undefined);
  assert.equal(omitted.existing_item_type, undefined);

  const nulled = ConflictJudgmentSchema.parse({
    has_conflict: false,
    conflict_type: 'NONE',
    severity: 'LOW',
    existing_item_id: null,
    existing_item_type: null,
    explanation: 'Compatible with prior decisions.',
    confidence: 0.88,
    requires_approval: false,
  });
  assert.equal(nulled.existing_item_id, null);
  assert.equal(nulled.existing_item_type, null);
});

test('Test 1 — New speaker with role is attributed dynamically without Unknown Speaker', () => {
  const db = setupTestDb();
  const segments = parseTranscript('Karthik (QA Lead): I will complete testing by December 9.');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].speakerName, 'Karthik');
  assert.equal(segments[0].speakerRole, 'QA Lead');
  assert.notEqual(segments[0].speakerName, 'Unknown Speaker');
  assert.equal(segments[0].text, 'I will complete testing by December 9.');

  // Confirm Karthik is not matched to any seeded user
  const matched = resolveTeamMember([...DEMO_USERS] as unknown as Parameters<typeof resolveTeamMember>[0], segments[0].speakerName);
  assert.equal(matched, null);
  db.close();
});

test('Test 2 & Test 3 — New owner Meera resolves downstream while unknown owner remains unconfirmed', async () => {
  const db = setupTestDb();
  const meetingId = randomUUID();
  const transcript = [
    'Meera (Compliance Lead): I can own the compliance report.',
    'Priya (Product Manager): Meera, please prepare the compliance report by December 12. Someone from the QA team should complete testing by Friday.',
  ].join('\n\n');

  db.prepare(
    `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, raw_transcript, processing_status)
     VALUES (?, ?, 'Compliance & QA Sync', '2026-11-21', 'PASTE', ?, 'UPLOADED')`
  ).run(meetingId, ACME_TEAM_ID, transcript);

  await processMeetingPipeline(db, meetingId, {
    runExtraction: async () => ({
      summary: 'Assigned compliance report to Meera; QA testing owner left unassigned.',
      mentioned_people: ['Meera', 'Priya Sharma'],
      decisions: [],
      action_items: [
        {
          title: 'Prepare compliance report',
          description: 'Meera, please prepare the compliance report by December 12.',
          owner_name: 'Meera',
          owner_confirmed: true,
          due_date: '2026-12-12',
          priority: 'HIGH',
          is_open_loop: false,
          source_segment_sequence: 2,
        },
        {
          title: 'Complete testing',
          description: 'Someone from the QA team should complete testing by Friday.',
          owner_name: 'Someone from the QA team',
          owner_confirmed: false,
          due_date: '2026-11-27',
          priority: 'MEDIUM',
          is_open_loop: true,
          open_loop_reason: 'Owner not confirmed',
          source_segment_sequence: 2,
        },
      ],
      dependencies: [],
      open_loops: [],
    }),
  });

  const actions = getStructuredActions(db, ACME_TEAM_ID).filter((a) => a.meeting_id === meetingId);
  const meeraAction = actions.find((a) => a.title === 'Prepare compliance report');
  const unknownAction = actions.find((a) => a.title === 'Complete testing');

  assert.ok(meeraAction);
  assert.equal(meeraAction.owner_name, 'Meera');
  assert.equal(meeraAction.owner_id, null);
  assert.equal(meeraAction.is_open_loop, 0);
  assert.equal(meeraAction.open_loop_reason, null);

  assert.ok(unknownAction);
  assert.equal(unknownAction.owner_name, null);
  assert.equal(unknownAction.owner_id, null);
  assert.equal(unknownAction.is_open_loop, 1);
  assert.equal(unknownAction.open_loop_reason, 'Owner not confirmed');

  // Reminders must NOT falsely flag Meera's task as "Owner not confirmed"
  const reminders = evaluateReminders(db, ACME_TEAM_ID, '2026-11-21');
  const falseMeeraRisk = reminders.find(
    (r) => r.action_item_id === meeraAction.id && r.message.includes('Owner not confirmed')
  );
  assert.equal(falseMeeraRisk, undefined);

  const unknownRisk = reminders.find((r) => r.action_item_id === unknownAction.id);
  assert.ok(unknownRisk);
  assert.match(unknownRisk.message, /Owner not confirmed/);

  db.close();
});

test('Test 4 — Existing seeded users (Priya, Rahul, Ananya) still resolve cleanly across Name (Role) formatting', () => {
  const users = DEMO_USERS.map((u) => ({ ...u, avatar_url: null, created_at: '2026-11-15T09:00:00Z' }));
  const priyaFromRole = resolveOwnerIdentity({
    candidateName: 'Priya (Product Manager)',
    confirmed: true,
    teamMembers: users,
  });
  assert.equal(priyaFromRole.user?.id, DEMO_USERS[0].id);
  assert.equal(priyaFromRole.ownerName, 'Priya Sharma');

  const rahulFromFirst = resolveOwnerIdentity({
    candidateName: 'Rahul',
    confirmed: true,
    teamMembers: users,
  });
  assert.equal(rahulFromFirst.user?.id, DEMO_USERS[1].id);
  assert.equal(rahulFromFirst.ownerName, 'Rahul Mehta');

  const ananyaFromFull = resolveOwnerIdentity({
    candidateName: 'Ananya Krishnan',
    confirmed: true,
    teamMembers: users,
  });
  assert.equal(ananyaFromFull.user?.id, DEMO_USERS[2].id);
  assert.equal(ananyaFromFull.ownerName, 'Ananya Krishnan');
});

test('Test 5 — Multiple new people in one transcript are attributed independently without duplicates', () => {
  const db = setupTestDb();
  const initialUsersCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number }).cnt;

  const transcript = [
    'Priya (Product Manager): Good morning, everyone. We need to finalize the payment platform launch schedule.',
    'Rahul (Engineering Lead): From the engineering side, we can complete development by December 7.',
    'Karthik (QA Lead): I will need at least two days after development to finish QA testing by December 9.',
    'Ananya (Security Lead): Security certification can complete by December 8.',
    'Karthik (QA Lead): Please ping me once the build is ready.',
    'Vikram (DevOps Lead): Infrastructure monitoring is ready.',
  ].join('\n\n');

  const parsed = parseTranscript(transcript);
  assert.equal(parsed.length, 6);
  assert.deepEqual(
    parsed.map((p) => p.speakerName),
    ['Priya', 'Rahul', 'Karthik', 'Ananya', 'Karthik', 'Vikram']
  );
  assert.deepEqual(
    parsed.map((p) => p.speakerRole),
    ['Product Manager', 'Engineering Lead', 'QA Lead', 'Security Lead', 'QA Lead', 'DevOps Lead']
  );
  assert.ok(parsed.every((p) => p.speakerName !== 'Unknown Speaker'));

  const participants = extractParticipantsFromSegments(
    parsed.map((s) => ({ speaker_name: s.speakerName, speaker_role: s.speakerRole, speaker_id: null }))
  );
  assert.deepEqual(
    participants.map((p) => p.name),
    ['Priya', 'Rahul', 'Karthik', 'Ananya', 'Vikram']
  );

  // Confirm no extra users were implicitly inserted into users table
  const afterUsersCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number }).cnt;
  assert.equal(afterUsersCount, initialUsersCount);
  db.close();
});

test('Gemini fallback — primary model succeeds directly without calling fallback', async () => {
  resetGeminiFallbackState();
  const calledModels: string[] = [];
  const mockClient: GeminiClientLike = {
    models: {
      generateContent: async (params) => {
        calledModels.push(params.model);
        return { text: JSON.stringify({ ok: true }) } as Awaited<
          ReturnType<GeminiClientLike['models']['generateContent']>
        >;
      },
    },
  };

  const { result, fallbackEvents } = await runWithGeminiContext(() =>
    generateContentResilient(
      { contents: 'Extract summary' },
      { client: mockClient }
    )
  );

  assert.deepEqual(calledModels, ['gemini-4-hydrogen']);
  assert.equal(fallbackEvents.length, 0);
  assert.equal(result.text, JSON.stringify({ ok: true }));
  assert.equal(getGeminiFallbackStatus().primaryInQuotaCooldown, false);
});

test('Gemini fallback — primary 429 quota exhaustion retries with fallback using identical contract and skips exhausted primary on follow-up', async () => {
  resetGeminiFallbackState();
  const db = setupTestDb();
  const calls: Array<{ model: string; contents: unknown; hasSchema: boolean; hasSystemInstruction: boolean }> = [];

  const validExtractionPayload = {
    summary: 'Karthik needs two days after engineering for QA testing by Dec 9.',
    mentioned_people: ['Karthik'],
    decisions: [],
    action_items: [
      {
        title: 'Complete QA testing',
        description: 'Run full QA suite after dev handoff.',
        owner_name: 'Karthik',
        owner_confirmed: true,
        due_date: '2026-12-09',
        priority: 'HIGH',
        is_open_loop: false,
        source_segment_sequence: 1,
      },
    ],
    dependencies: [],
    open_loops: [],
  };

  const mockClient: GeminiClientLike = {
    models: {
      generateContent: async (params) => {
        const cfg = params.config as Record<string, unknown> | undefined;
        calls.push({
          model: params.model,
          contents: params.contents,
          hasSchema: Boolean(cfg?.responseSchema),
          hasSystemInstruction: Boolean(cfg?.systemInstruction),
        });
        if (params.model === 'gemini-4-hydrogen') {
          const err = new Error(
            '{"error":{"code":429,"message":"You exceeded your current quota, quotaMetric: GenerateRequestsPerDayPerProjectPerModel-FreeTier","status":"RESOURCE_EXHAUSTED"}}'
          ) as Error & { status?: number };
          err.status = 429;
          throw err;
        }
        return { text: JSON.stringify(validExtractionPayload) } as Awaited<
          ReturnType<GeminiClientLike['models']['generateContent']>
        >;
      },
    },
  };

  const segments = parseTranscript('Karthik (QA Lead): I will complete QA testing by December 9.');
  const segmentRows = segments.map((s) => ({
    id: randomUUID(),
    meeting_id: 'm-429',
    speaker_name: s.speakerName,
    speaker_role: s.speakerRole,
    speaker_id: null,
    start_time: null,
    end_time: null,
    text: s.text,
    sequence_number: s.sequenceNumber,
    created_at: new Date().toISOString(),
  }));
  const users = DEMO_USERS.map((u) => ({ ...u, avatar_url: null, created_at: '2026-11-15T09:00:00Z' }));

  const firstRun = await runWithGeminiContext(() =>
    runMeetingUnderstandingAgent(
      {
        meetingTitle: 'QA Sync',
        meetingDate: '2026-11-21',
        segments: segmentRows,
        teamMembers: users,
      },
      { client: mockClient }
    )
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, 'gemini-4-hydrogen');
  assert.equal(calls[1].model, 'gemini-3.1-flash-lite');
  assert.equal(calls[1].contents, calls[0].contents);
  assert.equal(calls[1].hasSchema, true);
  assert.equal(calls[1].hasSystemInstruction, true);
  assert.equal(firstRun.fallbackEvents.length, 1);
  assert.equal(firstRun.fallbackEvents[0].toModel, 'gemini-3.1-flash-lite');
  assert.equal(firstRun.result.action_items[0].owner_name, 'Karthik');
  assert.equal(firstRun.result.action_items[0].source_segment_sequence, 1);
  assert.equal(getGeminiFallbackStatus().primaryInQuotaCooldown, true);

  // Follow-up request during quota cooldown goes directly to fallback without wasting a primary request
  await generateContentResilient({ contents: 'Follow-up check' }, { client: mockClient });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].model, 'gemini-3.1-flash-lite');

  resetGeminiFallbackState();
  db.close();
});

test('Gemini fallback — primary 503 unavailability retries with fallback and succeeds', async () => {
  resetGeminiFallbackState();
  const calledModels: string[] = [];
  const mockClient: GeminiClientLike = {
    models: {
      generateContent: async (params) => {
        calledModels.push(params.model);
        if (params.model === 'gemini-4-hydrogen') {
          const err = new Error('503 UNAVAILABLE: model experiencing high demand') as Error & { status?: number };
          err.status = 503;
          throw err;
        }
        return { text: JSON.stringify({ status: 'recovered' }) } as Awaited<
          ReturnType<GeminiClientLike['models']['generateContent']>
        >;
      },
    },
  };

  const { result, fallbackEvents } = await runWithGeminiContext(() =>
    generateContentResilient({ contents: 'Conflict judgment prompt' }, { client: mockClient })
  );

  assert.deepEqual(calledModels, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
  assert.equal(fallbackEvents.length, 1);
  assert.equal(result.text, JSON.stringify({ status: 'recovered' }));
  // Transient 503 should NOT lock primary into quota cooldown
  assert.equal(getGeminiFallbackStatus().primaryInQuotaCooldown, false);
});

test('Gemini fallback — both primary and fallback failing throws clean user-facing error and preserves transcript data', async () => {
  resetGeminiFallbackState();
  const db = setupTestDb();
  const calledModels: string[] = [];

  const mockClient: GeminiClientLike = {
    models: {
      generateContent: async (params) => {
        calledModels.push(params.model);
        const err = new Error(
          `{"error":{"code":429,"message":"Raw internal quota JSON for ${params.model}","status":"RESOURCE_EXHAUSTED"}}`
        ) as Error & { status?: number };
        err.status = 429;
        throw err;
      },
    },
  };

  await assert.rejects(
    () => generateContentResilient({ contents: 'Test prompt' }, { client: mockClient }),
    (err: unknown) => {
      assert.ok(err instanceof GeminiUnavailableError);
      assert.match(err.message, /temporarily unavailable/i);
      assert.match(err.message, /not been corrupted/i);
      assert.doesNotMatch(err.message, /RESOURCE_EXHAUSTED|Raw internal quota JSON|\{"error"/);
      return true;
    }
  );
  assert.deepEqual(calledModels, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

  // Also confirm processMeetingPipeline preserves transcript & sets clean processing_error
  resetGeminiFallbackState();
  const meetingId = randomUUID();
  const rawTranscript = 'Priya (Product Manager): Keep this transcript safe even if AI is unavailable.';
  db.prepare(
    `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, raw_transcript, processing_status)
     VALUES (?, ?, 'Outage Resilience Check', '2026-11-21', 'PASTE', ?, 'UPLOADED')`
  ).run(meetingId, ACME_TEAM_ID, rawTranscript);

  await assert.rejects(
    () =>
      processMeetingPipeline(db, meetingId, {
        runExtraction: async (params) =>
          runMeetingUnderstandingAgent(params, { client: mockClient }),
      }),
    (err: unknown) => err instanceof GeminiUnavailableError
  );

  const savedMeeting = db
    .prepare(`SELECT raw_transcript, processing_status, processing_error FROM meetings WHERE id = ?`)
    .get(meetingId) as { raw_transcript: string; processing_status: string; processing_error: string };

  assert.equal(savedMeeting.raw_transcript, rawTranscript);
  assert.equal(savedMeeting.processing_status, 'FAILED');
  assert.match(savedMeeting.processing_error, /temporarily unavailable/i);
  assert.doesNotMatch(savedMeeting.processing_error, /RESOURCE_EXHAUSTED|Raw internal quota JSON|\{"error"/);

  resetGeminiFallbackState();
  db.close();
});



