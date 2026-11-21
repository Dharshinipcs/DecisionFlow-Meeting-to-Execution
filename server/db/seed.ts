import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export const ACME_TEAM_ID = '11111111-1111-1111-1111-111111111111';

export const DEMO_USERS = [
  {
    id: '22222222-2222-2222-2222-222222222201',
    name: 'Priya Sharma',
    email: 'priya@acme.dev',
    role: 'Product Lead',
  },
  {
    id: '22222222-2222-2222-2222-222222222202',
    name: 'Rahul Mehta',
    email: 'rahul@acme.dev',
    role: 'Engineering Lead',
  },
  {
    id: '22222222-2222-2222-2222-222222222203',
    name: 'Ananya Krishnan',
    email: 'ananya@acme.dev',
    role: 'Security Lead',
  },
  {
    id: '22222222-2222-2222-2222-222222222204',
    name: 'Arjun Verma',
    email: 'arjun@acme.dev',
    role: 'Platform Engineer',
  },
] as const;

export const MEETING_3_SAMPLE = {
  title: 'Payment Launch Review',
  meetingDate: '2026-11-21',
  sourceType: 'PASTE' as const,
  sourceFileName: 'payment-launch-review-nov21.txt',
  transcript: `Priya:
"We need to accelerate the payment launch."

Rahul:
"Engineering can support December 5."

Priya:
"Let's move the launch to December 5."

Ananya:
"Wait, security certification is currently scheduled for December 8."

Priya:
"Okay, then we need to see if security can bring that forward. Rahul, can you prepare the updated launch checklist?"

Rahul:
"Yes, I'll do that by November 23."`,
};

export function seedDemoWorkspace(db: Database.Database): void {
  const existingTeam = db.prepare('SELECT id FROM teams WHERE id = ?').get(ACME_TEAM_ID);
  if (existingTeam) {
    return;
  }

  const runSeed = db.transaction(() => {
    db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(
      ACME_TEAM_ID,
      'Acme Product Team',
      '2026-11-15T09:00:00Z'
    );

    const insertUser = db.prepare(
      'INSERT INTO users (id, name, email, role, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO team_members (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
    );

    for (const user of DEMO_USERS) {
      insertUser.run(user.id, user.name, user.email, user.role, '2026-11-15T09:00:00Z');
      insertMember.run(randomUUID(), ACME_TEAM_ID, user.id, user.role, '2026-11-15T09:00:00Z');
    }

    const priyaId = DEMO_USERS[0].id;
    const rahulId = DEMO_USERS[1].id;
    const ananyaId = DEMO_USERS[2].id;

    // ---- Meeting 1: Payment Launch Planning (Nov 18, 2026) ----
    const meeting1Id = '33333333-3333-3333-3333-333333333301';
    const meeting1Transcript = `Priya:
"Let's make December 10 our payment launch date."

Rahul:
"Engineering can be ready by December 10."

Ananya:
"Security certification will also be completed before December 10."

Priya:
"Okay, let's make December 10 the launch date."

Rahul:
"I'll prepare the payment API documentation before then."

Priya:
"Rahul, please have that ready by November 25."`;

    db.prepare(
      `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, source_file_name, raw_transcript, processing_status, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?, ?, ?)`
    ).run(
      meeting1Id,
      ACME_TEAM_ID,
      'Payment Launch Planning',
      '2026-11-18',
      'TXT',
      'payment-launch-planning-nov18.txt',
      meeting1Transcript,
      'Team aligned on launching the payment service on December 10, 2026, with engineering readiness and security certification expected prior to launch. Rahul committed to preparing payment API documentation by November 25.',
      '2026-11-18T10:00:00Z',
      '2026-11-18T10:05:00Z'
    );

    const m1Segments = [
      { id: '44444444-4444-4444-4444-444444444401', speaker: 'Priya', speakerId: priyaId, seq: 1, text: "Let's make December 10 our payment launch date." },
      { id: '44444444-4444-4444-4444-444444444402', speaker: 'Rahul', speakerId: rahulId, seq: 2, text: 'Engineering can be ready by December 10.' },
      { id: '44444444-4444-4444-4444-444444444403', speaker: 'Ananya', speakerId: ananyaId, seq: 3, text: 'Security certification will also be completed before December 10.' },
      { id: '44444444-4444-4444-4444-444444444404', speaker: 'Priya', speakerId: priyaId, seq: 4, text: "Okay, let's make December 10 the launch date." },
      { id: '44444444-4444-4444-4444-444444444405', speaker: 'Rahul', speakerId: rahulId, seq: 5, text: "I'll prepare the payment API documentation before then." },
      { id: '44444444-4444-4444-4444-444444444406', speaker: 'Priya', speakerId: priyaId, seq: 6, text: 'Rahul, please have that ready by November 25.' },
    ];

    const insertSegment = db.prepare(
      `INSERT INTO transcript_segments (id, meeting_id, speaker_name, speaker_id, start_time, end_time, text, sequence_number, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
    );

    for (const seg of m1Segments) {
      insertSegment.run(seg.id, meeting1Id, seg.speaker, seg.speakerId, seg.text, seg.seq, '2026-11-18T10:01:00Z');
    }

    const dec10DecisionId = '55555555-5555-5555-5555-555555555501';
    db.prepare(
      `INSERT INTO decisions (id, team_id, meeting_id, topic, decision_text, status, owner_id, rationale, effective_date, source_segment_id, supersedes_decision_id, is_proposal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, NULL, 0, ?, ?)`
    ).run(
      dec10DecisionId,
      ACME_TEAM_ID,
      meeting1Id,
      'Payment launch',
      'Launch payment service on December 10, 2026',
      priyaId,
      'Engineering and security readiness aligned for December 10.',
      '2026-12-10',
      m1Segments[3].id,
      '2026-11-18T10:02:00Z',
      '2026-11-18T10:05:00Z'
    );

    db.prepare(
      `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
       VALUES (?, ?, 1, ?, ?, 'ACTIVE', ?, ?, ?)`
    ).run(
      '66666666-6666-6666-6666-666666666601',
      dec10DecisionId,
      'Launch payment service on December 10, 2026',
      '2026-12-10',
      meeting1Id,
      m1Segments[3].id,
      '2026-11-18T10:05:00Z'
    );

    const apiDocActionId = '77777777-7777-7777-7777-777777777701';
    db.prepare(
      `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'HIGH', 'OPEN', 0, NULL, ?, ?, ?)`
    ).run(
      apiDocActionId,
      ACME_TEAM_ID,
      meeting1Id,
      'Prepare payment API documentation',
      'Prepare complete payment API documentation prior to the payment launch.',
      rahulId,
      '2026-11-25',
      m1Segments[5].id,
      '2026-11-18T10:03:00Z',
      '2026-11-18T10:05:00Z'
    );

    db.prepare(
      `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, status, reviewed_by, reviewed_at, created_at)
       VALUES (?, ?, 'ACTION_ITEM', ?, ?, ?, 'APPROVED', ?, ?, ?)`
    ).run(
      '88888888-8888-8888-8888-888888888801',
      ACME_TEAM_ID,
      apiDocActionId,
      'Prepare payment API documentation',
      'Action extracted from Payment Launch Planning (Nov 18)',
      priyaId,
      '2026-11-18T10:05:00Z',
      '2026-11-18T10:04:00Z'
    );

    // ---- Meeting 2: Security Review (Nov 20, 2026) ----
    const meeting2Id = '33333333-3333-3333-3333-333333333302';
    const meeting2Transcript = `Rahul:
"Security certification will complete by December 8."`;

    db.prepare(
      `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, source_file_name, raw_transcript, processing_status, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?, ?, ?)`
    ).run(
      meeting2Id,
      ACME_TEAM_ID,
      'Security Review',
      '2026-11-20',
      'TXT',
      'security-review-nov20.txt',
      meeting2Transcript,
      'Confirmed security certification target completion date of December 8, 2026 as a prerequisite before the payment launch.',
      '2026-11-20T14:00:00Z',
      '2026-11-20T14:03:00Z'
    );

    const m2Seg1Id = '44444444-4444-4444-4444-444444444410';
    insertSegment.run(
      m2Seg1Id,
      meeting2Id,
      'Rahul',
      rahulId,
      'Security certification will complete by December 8.',
      1,
      '2026-11-20T14:01:00Z'
    );

    const secCertActionId = '77777777-7777-7777-7777-777777777702';
    db.prepare(
      `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'HIGH', 'IN_PROGRESS', 0, NULL, ?, ?, ?)`
    ).run(
      secCertActionId,
      ACME_TEAM_ID,
      meeting2Id,
      'Complete security certification',
      'Complete security certification required ahead of payment launch.',
      rahulId,
      '2026-12-08',
      m2Seg1Id,
      '2026-11-20T14:02:00Z',
      '2026-11-20T14:03:00Z'
    );

    db.prepare(
      `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, status, reviewed_by, reviewed_at, created_at)
       VALUES (?, ?, 'ACTION_ITEM', ?, ?, ?, 'APPROVED', ?, ?, ?)`
    ).run(
      '88888888-8888-8888-8888-888888888802',
      ACME_TEAM_ID,
      secCertActionId,
      'Complete security certification',
      'Action extracted from Security Review (Nov 20)',
      priyaId,
      '2026-11-20T14:03:00Z',
      '2026-11-20T14:02:30Z'
    );

    // Dependency: Complete security certification MUST_HAPPEN_BEFORE Payment launch
    db.prepare(
      `INSERT INTO dependencies (id, team_id, source_type, source_id, target_type, target_id, relationship, description, created_at)
       VALUES (?, ?, 'ACTION_ITEM', ?, 'DECISION', ?, 'MUST_HAPPEN_BEFORE', ?, ?)`
    ).run(
      '99999999-9999-9999-9999-999999999901',
      ACME_TEAM_ID,
      secCertActionId,
      dec10DecisionId,
      'Security certification must be completed before Payment launch can go live.',
      '2026-11-20T14:03:00Z'
    );

    // Seed memory records (will be enriched with Gemini embeddings lazily or on query if empty)
    const insertMemory = db.prepare(
      `INSERT INTO memory_embeddings (id, team_id, source_type, source_id, content, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      'DECISION',
      dec10DecisionId,
      'Decision: Payment launch — Launch payment service on December 10, 2026 (effective 2026-12-10). Owner: Priya Sharma. Rationale: Engineering and security readiness aligned for December 10. Source quote: "Okay, let\'s make December 10 the launch date."',
      JSON.stringify({ meetingId: meeting1Id, meetingTitle: 'Payment Launch Planning', meetingDate: '2026-11-18', speaker: 'Priya' }),
      '2026-11-18T10:05:00Z'
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      'ACTION_ITEM',
      apiDocActionId,
      'Action: Prepare payment API documentation. Owner: Rahul Mehta. Due: 2026-11-25. Status: OPEN.',
      JSON.stringify({ meetingId: meeting1Id, meetingTitle: 'Payment Launch Planning', meetingDate: '2026-11-18', speaker: 'Priya' }),
      '2026-11-18T10:05:00Z'
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      'ACTION_ITEM',
      secCertActionId,
      'Action: Complete security certification. Owner: Rahul Mehta. Due: 2026-12-08. Status: IN_PROGRESS. Dependency: Must happen before Payment launch.',
      JSON.stringify({ meetingId: meeting2Id, meetingTitle: 'Security Review', meetingDate: '2026-11-20', speaker: 'Rahul' }),
      '2026-11-20T14:03:00Z'
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      'MEETING_SUMMARY',
      meeting1Id,
      'Payment Launch Planning (2026-11-18): Team aligned on launching the payment service on December 10, 2026. Rahul will prepare payment API documentation by November 25.',
      JSON.stringify({ meetingId: meeting1Id, meetingTitle: 'Payment Launch Planning', meetingDate: '2026-11-18' }),
      '2026-11-18T10:05:00Z'
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      'MEETING_SUMMARY',
      meeting2Id,
      'Security Review (2026-11-20): Rahul confirmed security certification will complete by December 8, which must happen before Payment launch.',
      JSON.stringify({ meetingId: meeting2Id, meetingTitle: 'Security Review', meetingDate: '2026-11-20' }),
      '2026-11-20T14:03:00Z'
    );

    // Seed Audit Events
    const insertAudit = db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAudit.run(
      randomUUID(),
      ACME_TEAM_ID,
      priyaId,
      'MEETING_PROCESSED',
      'MEETING',
      meeting1Id,
      'Processed "Payment Launch Planning" (6 transcript segments analyzed, 1 decision and 1 action extracted).',
      JSON.stringify({ meetingDate: '2026-11-18' }),
      '2026-11-18T10:05:00Z'
    );
    insertAudit.run(
      randomUUID(),
      ACME_TEAM_ID,
      priyaId,
      'APPROVAL_GRANTED',
      'DECISION',
      dec10DecisionId,
      'Confirmed active decision: Payment launch on December 10, 2026.',
      JSON.stringify({ effectiveDate: '2026-12-10' }),
      '2026-11-18T10:05:30Z'
    );
    insertAudit.run(
      randomUUID(),
      ACME_TEAM_ID,
      rahulId,
      'MEETING_PROCESSED',
      'MEETING',
      meeting2Id,
      'Processed "Security Review" and linked dependency: Complete security certification (Dec 8) must happen before Payment launch.',
      JSON.stringify({ meetingDate: '2026-11-20' }),
      '2026-11-20T14:03:00Z'
    );
  });

  runSeed();
}

export function resetAndSeedDemoWorkspace(db: Database.Database): void {
  const clearAll = db.transaction(() => {
    db.exec(`
      DELETE FROM audit_events;
      DELETE FROM memory_embeddings;
      DELETE FROM weekly_digests;
      DELETE FROM reminders;
      DELETE FROM external_tasks;
      DELETE FROM approval_items;
      DELETE FROM conflicts;
      DELETE FROM dependencies;
      DELETE FROM action_items;
      DELETE FROM decision_versions;
      DELETE FROM decisions;
      DELETE FROM transcript_segments;
      DELETE FROM meetings;
      DELETE FROM team_members;
      DELETE FROM users;
      DELETE FROM teams;
    `);
  });
  clearAll();
  seedDemoWorkspace(db);
}
