import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { parseTranscript } from '../utils/transcriptParser.ts';
import { runWithGeminiContext, sanitizeGeminiErrorMessage } from '../ai/client.ts';
import { upsertMemoryRecord } from '../memory/embeddings.ts';
import { getStructuredDependencies } from '../memory/retrieval.ts';
import { runConflictReasoningAgent } from './conflict-agent.ts';
import { evaluateReminders } from './followup-agent.ts';
import {
  extractParticipantsFromSegments,
  getTeamMembers,
  resolveOwnerIdentity,
  resolveTeamMember,
  runMeetingUnderstandingAgent,
} from './meeting-agent.ts';
import type {
  ActionItem,
  ApprovalItem,
  Decision,
  Meeting,
  TranscriptSegment,
} from '../../src/types/decisionflow.ts';

export interface AgentTimelineStep {
  step: string;
  detail: string;
  timestamp: string;
}

export interface ProcessMeetingResult {
  meeting: Meeting;
  alreadyProcessed: boolean;
  timeline: AgentTimelineStep[];
  extractedDecisionsCount: number;
  extractedActionsCount: number;
  conflictsDetectedCount: number;
  approvalsCreatedCount: number;
  aiFallbackUsed?: boolean;
  aiStatus?: string;
}

export async function processMeetingPipeline(
  db: Database.Database,
  meetingId: string,
  options?: {
    runExtraction?: typeof runMeetingUnderstandingAgent;
  }
): Promise<ProcessMeetingResult> {
  const meeting = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId) as
    | (Meeting & { raw_transcript: string })
    | undefined;

  if (!meeting) {
    throw new Error('Meeting not found.');
  }

  // Idempotency guard: do not duplicate extractions on already-processed meetings
  if (meeting.processing_status === 'PROCESSED') {
    const decCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM decisions WHERE meeting_id = ?`).get(meetingId) as { cnt: number }
    ).cnt;
    const actCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM action_items WHERE meeting_id = ?`).get(meetingId) as { cnt: number }
    ).cnt;
    const confCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM conflicts WHERE meeting_id = ?`).get(meetingId) as { cnt: number }
    ).cnt;

    return {
      meeting,
      alreadyProcessed: true,
      timeline: [
        {
          step: 'Already processed',
          detail: 'Returning existing extracted decisions, actions, and conflicts.',
          timestamp: meeting.updated_at,
        },
      ],
      extractedDecisionsCount: decCount,
      extractedActionsCount: actCount,
      conflictsDetectedCount: confCount,
      approvalsCreatedCount: 0,
    };
  }

  const timeline: AgentTimelineStep[] = [];
  const pushStep = (step: string, detail: string) => {
    timeline.push({ step, detail, timestamp: new Date().toISOString() });
  };

  db.prepare(
    `UPDATE meetings SET processing_status = 'PROCESSING', processing_error = NULL, updated_at = datetime('now') WHERE id = ?`
  ).run(meetingId);

  try {
    // 1. Parse transcript deterministically
    const parsedSegments = parseTranscript(meeting.raw_transcript);
    if (parsedSegments.length === 0) {
      throw new Error('Transcript contains no recognizable statements.');
    }

    const teamMembers = getTeamMembers(db, meeting.team_id);

    // Clear partial segments/items only if retrying a FAILED meeting
    db.transaction(() => {
      db.prepare(`DELETE FROM transcript_segments WHERE meeting_id = ?`).run(meetingId);
      const insertSeg = db.prepare(
        `INSERT INTO transcript_segments (id, meeting_id, speaker_name, speaker_role, speaker_id, start_time, end_time, text, sequence_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      );
      for (const seg of parsedSegments) {
        const matchedUser = resolveTeamMember(teamMembers, seg.speakerName);
        insertSeg.run(
          randomUUID(),
          meetingId,
          seg.speakerName,
          seg.speakerRole,
          matchedUser?.id ?? null,
          seg.startTime,
          seg.endTime,
          seg.text,
          seg.sequenceNumber
        );
      }
    })();

    const storedSegments = db
      .prepare(`SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_number ASC`)
      .all(meetingId) as TranscriptSegment[];

    const dynamicParticipants = extractParticipantsFromSegments(storedSegments);
    pushStep(
      'Transcript parsed',
      `${storedSegments.length} speaker-attributed statements stored (${dynamicParticipants.length} participant${dynamicParticipants.length === 1 ? '' : 's'}).`
    );

    const segmentBySeq = new Map<number, TranscriptSegment>();
    for (const s of storedSegments) {
      segmentBySeq.set(s.sequence_number, s);
    }

    // 2. Run Meeting Understanding Agent (Gemini structured extraction)
    const extractFn = options?.runExtraction ?? runMeetingUnderstandingAgent;
    const extractionRun = await runWithGeminiContext(() =>
      extractFn({
        meetingTitle: meeting.title,
        meetingDate: meeting.meeting_date,
        segments: storedSegments,
        teamMembers,
      })
    );
    const extraction = extractionRun.result;
    let fallbackEvents = [...extractionRun.fallbackEvents];

    pushStep(
      'Meeting understood',
      `${extraction.decisions.length} decision candidate(s), ${extraction.action_items.length} action(s), ${extraction.open_loops.length} open loop(s) extracted.`
    );

    // 3. Persist extracted decisions, actions, dependencies, and open loops
    const createdDecisions: Array<{ decision: Decision; sourceSeg: TranscriptSegment | null }> = [];
    const createdActions: Array<{ action: ActionItem; sourceSeg: TranscriptSegment | null }> = [];
    let approvalsCreatedCount = 0;

    db.transaction(() => {
      for (const dec of extraction.decisions) {
        const seg = segmentBySeq.get(dec.source_segment_sequence) ?? storedSegments[0] ?? null;
        const resolvedDecOwner = resolveOwnerIdentity({
          candidateName: dec.owner_name ?? (seg?.speaker_name && seg.speaker_name !== 'Unknown Speaker' ? seg.speaker_name : null),
          confirmed: true,
          teamMembers,
          participants: dynamicParticipants,
        });
        const ownerUser =
          resolvedDecOwner.user ??
          (seg?.speaker_id ? teamMembers.find((u) => u.id === seg.speaker_id) ?? null : null);
        const ownerName = ownerUser?.name ?? resolvedDecOwner.ownerName ?? null;
        const decId = randomUUID();
        const isProposalFlag = dec.classification === 'PROPOSAL' ? 1 : 0;

        db.prepare(
          `INSERT INTO decisions (id, team_id, meeting_id, topic, decision_text, status, owner_id, owner_name, rationale, effective_date, source_segment_id, supersedes_decision_id, is_proposal, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'))`
        ).run(
          decId,
          meeting.team_id,
          meetingId,
          dec.topic,
          dec.decision_text,
          ownerUser?.id ?? null,
          ownerName,
          dec.rationale ?? null,
          dec.effective_date ?? null,
          seg?.id ?? null,
          isProposalFlag
        );

        db.prepare(
          `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
           VALUES (?, ?, 1, ?, ?, 'PROPOSED', ?, ?, datetime('now'))`
        ).run(randomUUID(), decId, dec.decision_text, dec.effective_date ?? null, meetingId, seg?.id ?? null);

        const savedDec = db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(decId) as Decision;
        createdDecisions.push({ decision: savedDec, sourceSeg: seg });
      }

      for (const act of extraction.action_items) {
        const seg = segmentBySeq.get(act.source_segment_sequence) ?? storedSegments[0] ?? null;
        const resolvedOwner = resolveOwnerIdentity({
          candidateName: act.owner_name,
          confirmed: act.owner_confirmed,
          teamMembers,
          participants: dynamicParticipants,
        });
        const ownerUser = resolvedOwner.user;
        const resolvedOwnerName = resolvedOwner.ownerName;
        const hasConfirmedOwner = Boolean(ownerUser || resolvedOwnerName);
        const isOpenLoop = act.is_open_loop || !hasConfirmedOwner || !act.due_date ? 1 : 0;
        const openLoopReason =
          (act.open_loop_reason?.trim() || null) ??
          (!hasConfirmedOwner
            ? 'Owner not confirmed'
            : !act.due_date
              ? 'Deadline not specified'
              : null);

        const actId = randomUUID();
        db.prepare(
          `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, owner_name, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, datetime('now'), datetime('now'))`
        ).run(
          actId,
          meeting.team_id,
          meetingId,
          act.title,
          act.description ?? null,
          ownerUser?.id ?? null,
          resolvedOwnerName,
          act.due_date ?? null,
          act.priority,
          isOpenLoop,
          openLoopReason,
          seg?.id ?? null
        );

        // Create approval item for action execution governance
        db.prepare(
          `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, proposed_payload, status, created_at)
           VALUES (?, ?, 'ACTION_ITEM', ?, ?, ?, ?, 'PENDING', datetime('now'))`
        ).run(
          randomUUID(),
          meeting.team_id,
          actId,
          act.title,
          `Action item proposed from "${meeting.title}"${resolvedOwnerName ? ` · Owner: ${resolvedOwnerName}` : ' · Owner not confirmed'}${act.due_date ? ` · Due: ${act.due_date}` : ''}`,
          JSON.stringify({
            actionId: actId,
            ownerId: ownerUser?.id ?? null,
            ownerName: resolvedOwnerName,
            dueDate: act.due_date ?? null,
            priority: act.priority,
          })
        );
        approvalsCreatedCount++;

        const savedAct = db.prepare(`SELECT * FROM action_items WHERE id = ?`).get(actId) as ActionItem;
        createdActions.push({ action: savedAct, sourceSeg: seg });
      }

      // Also persist explicit open loops that weren't captured as action items
      for (const loop of extraction.open_loops) {
        const alreadyCovered = createdActions.some(
          (a) => a.action.title.toLowerCase() === loop.title.toLowerCase()
        );
        if (!alreadyCovered) {
          const seg = segmentBySeq.get(loop.source_segment_sequence) ?? storedSegments[0] ?? null;
          const actId = randomUUID();
          db.prepare(
            `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, 'MEDIUM', 'PROPOSED', 1, ?, ?, datetime('now'), datetime('now'))`
          ).run(actId, meeting.team_id, meetingId, loop.title, loop.reason, loop.reason, seg?.id ?? null);
        }
      }

      // Store extracted dependencies by matching against newly created or existing active items
      const allDecisions = db
        .prepare(`SELECT id, topic, decision_text FROM decisions WHERE team_id = ?`)
        .all(meeting.team_id) as Array<{ id: string; topic: string; decision_text: string }>;
      const allActions = db
        .prepare(`SELECT id, title FROM action_items WHERE team_id = ?`)
        .all(meeting.team_id) as Array<{ id: string; title: string }>;

      const resolveEntity = (title: string, kind: 'DECISION' | 'ACTION_ITEM') => {
        const q = title.toLowerCase();
        if (kind === 'ACTION_ITEM') {
          const found = allActions.find(
            (a) => a.title.toLowerCase().includes(q) || q.includes(a.title.toLowerCase())
          );
          if (found) return { type: 'ACTION_ITEM' as const, id: found.id };
        }
        const foundDec = allDecisions.find(
          (d) =>
            d.topic.toLowerCase().includes(q) ||
            q.includes(d.topic.toLowerCase()) ||
            d.decision_text.toLowerCase().includes(q)
        );
        if (foundDec) return { type: 'DECISION' as const, id: foundDec.id };
        const fallbackAct = allActions.find(
          (a) => a.title.toLowerCase().includes(q) || q.includes(a.title.toLowerCase())
        );
        return fallbackAct ? { type: 'ACTION_ITEM' as const, id: fallbackAct.id } : null;
      };

      for (const dep of extraction.dependencies) {
        const src = resolveEntity(dep.source_title, dep.source_kind);
        const tgt = resolveEntity(dep.target_title, dep.target_kind);
        if (src && tgt && !(src.type === tgt.type && src.id === tgt.id)) {
          db.prepare(
            `INSERT OR IGNORE INTO dependencies (id, team_id, source_type, source_id, target_type, target_id, relationship, description, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          ).run(randomUUID(), meeting.team_id, src.type, src.id, tgt.type, tgt.id, dep.relationship, dep.description);
        }
      }
    })();

    // 4. Generate and persist semantic memory embeddings in parallel
    await Promise.allSettled([
      upsertMemoryRecord(db, {
        teamId: meeting.team_id,
        sourceType: 'MEETING_SUMMARY',
        sourceId: meetingId,
        content: `${meeting.title} (${meeting.meeting_date}): ${extraction.summary}`,
        metadata: { meetingId, meetingTitle: meeting.title, meetingDate: meeting.meeting_date },
      }),
      ...storedSegments.map((seg) =>
        upsertMemoryRecord(db, {
          teamId: meeting.team_id,
          sourceType: 'TRANSCRIPT',
          sourceId: seg.id,
          content: `${meeting.title} (${meeting.meeting_date}) — ${seg.speaker_name}: "${seg.text}"`,
          metadata: {
            meetingId,
            meetingTitle: meeting.title,
            meetingDate: meeting.meeting_date,
            speaker: seg.speaker_name,
          },
        })
      ),
    ]);

    pushStep('Memory indexed', 'Meeting summary and transcript segments stored in semantic + structured memory.');

    // 5. Run Conflict & Reasoning Agent for each extracted decision candidate
    let conflictsDetectedCount = 0;

    for (const { decision, sourceSeg } of createdDecisions) {
      const reasoningRun = await runWithGeminiContext(() =>
        runConflictReasoningAgent({
          db,
          teamId: meeting.team_id,
          proposedDecision: decision,
          sourceQuote: sourceSeg?.text ?? null,
          sourceSpeaker: sourceSeg?.speaker_name ?? null,
        })
      );
      fallbackEvents = [...fallbackEvents, ...reasoningRun.fallbackEvents];
      const reasoning = reasoningRun.result;

      pushStep(
        'Memory searched & reasoned',
        `Evaluated "${decision.topic}" against ${reasoning.memoryHitsCount} memory records.`
      );

      const { aiJudgment, deterministicFindings } = reasoning;

      // Determine primary existing reference if any
      let primaryExistingId = aiJudgment.existing_item_id;
      let primaryExistingType = aiJudgment.existing_item_type;

      // Also record deterministic dependency conflict if found and not already captured
      if (deterministicFindings.length > 0 && !aiJudgment.has_conflict) {
        const topDet = deterministicFindings[0];
        primaryExistingId = topDet.existingItemId;
        primaryExistingType = topDet.existingItemType;
      }

      if (aiJudgment.has_conflict || deterministicFindings.length > 0 || aiJudgment.conflict_type === 'SUPERSESSION') {
        const conflictType =
          aiJudgment.conflict_type !== 'NONE' && aiJudgment.conflict_type !== 'COMPATIBLE_UPDATE'
            ? aiJudgment.conflict_type
            : deterministicFindings[0]?.conflictType ?? 'DECISION_CONFLICT';

        const severity =
          deterministicFindings.some((f) => f.severity === 'HIGH')
            ? 'HIGH'
            : aiJudgment.severity;

        const explanation =
          deterministicFindings.length > 0 && !aiJudgment.explanation.includes(deterministicFindings[0].explanation)
            ? `${aiJudgment.explanation} ${deterministicFindings[0].explanation}`
            : aiJudgment.explanation;

        const existingId = primaryExistingId ?? decision.id;
        const existingType = primaryExistingType ?? 'DECISION';

        const conflictId = randomUUID();
        db.prepare(
          `INSERT INTO conflicts (id, team_id, meeting_id, conflict_type, severity, status, existing_item_type, existing_item_id, new_item_type, new_item_id, explanation, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, 'DECISION', ?, ?, ?, datetime('now'))`
        ).run(
          conflictId,
          meeting.team_id,
          meetingId,
          conflictType,
          severity,
          existingType,
          existingId,
          decision.id,
          explanation,
          aiJudgment.confidence
        );

        conflictsDetectedCount++;
        pushStep('Conflict detected', `${conflictType} (${severity}): ${explanation}`);

        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'CONFLICT_DETECTED', 'CONFLICT', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          meeting.team_id,
          decision.owner_id,
          conflictId,
          `Detected ${conflictType} (${severity}) on "${decision.topic}": ${explanation}`,
          JSON.stringify({ meetingId, decisionId: decision.id, confidence: aiJudgment.confidence })
        );
      }

      // Create mandatory human Approval Item for every proposed decision
      const approvalId = randomUUID();
      db.prepare(
        `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, proposed_payload, status, created_at)
         VALUES (?, ?, 'DECISION', ?, ?, ?, ?, 'PENDING', datetime('now'))`
      ).run(
        approvalId,
        meeting.team_id,
        decision.id,
        `${decision.topic}: ${decision.decision_text}`,
        aiJudgment.explanation,
        JSON.stringify({
          decisionId: decision.id,
          topic: decision.topic,
          effectiveDate: decision.effective_date,
          supersedesId: primaryExistingType === 'DECISION' ? primaryExistingId : null,
        })
      );
      approvalsCreatedCount++;

      db.prepare(
        `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
         VALUES (?, ?, ?, 'AI_PROPOSAL_CREATED', 'DECISION', ?, ?, ?, datetime('now'))`
      ).run(
        randomUUID(),
        meeting.team_id,
        decision.owner_id,
        decision.id,
        `Proposed decision "${decision.topic}: ${decision.decision_text}" queued for human approval.`,
        JSON.stringify({ approvalId, meetingId })
      );
    }

    const aiFallbackUsed = fallbackEvents.length > 0;
    const aiStatus = aiFallbackUsed
      ? `AI fallback used (${fallbackEvents[fallbackEvents.length - 1].toModel})`
      : undefined;

    if (aiFallbackUsed) {
      pushStep(
        'AI fallback used',
        `Completed seamlessly using ${fallbackEvents[fallbackEvents.length - 1].toModel}.`
      );
    }

    pushStep('Approval required', `${approvalsCreatedCount} item(s) added to Decision Inbox.`);

    // 6. Mark meeting PROCESSED and evaluate reminders
    db.prepare(
      `UPDATE meetings SET processing_status = 'PROCESSED', summary = ?, processing_error = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(extraction.summary, meetingId);

    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, NULL, 'MEETING_PROCESSED', 'MEETING', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      meeting.team_id,
      meetingId,
      `Processed "${meeting.title}": ${createdDecisions.length} decision(s), ${createdActions.length} action(s), ${conflictsDetectedCount} conflict(s).`,
      JSON.stringify({ timeline, aiFallbackUsed, aiStatus })
    );

    evaluateReminders(db, meeting.team_id);

    const updatedMeeting = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId) as Meeting;
    return {
      meeting: updatedMeeting,
      alreadyProcessed: false,
      timeline,
      extractedDecisionsCount: createdDecisions.length,
      extractedActionsCount: createdActions.length,
      conflictsDetectedCount,
      approvalsCreatedCount,
      aiFallbackUsed,
      aiStatus,
    };
  } catch (err) {
    const cleanMessage = sanitizeGeminiErrorMessage(err) || 'Meeting processing failed.';
    db.prepare(
      `UPDATE meetings SET processing_status = 'FAILED', processing_error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cleanMessage, meetingId);
    if (err instanceof Error && err.message === cleanMessage) {
      throw err;
    }
    throw new Error(cleanMessage);
  }
}

export interface ApprovalOutcome {
  approval: ApprovalItem;
  message: string;
  supersededDecisionId: string | null;
  activatedDecisionId: string | null;
  affectedItems: Array<{ type: string; id: string; title: string; warning: string }>;
}

export async function handleHumanApproval(
  db: Database.Database,
  params: {
    approvalId: string;
    decision: 'APPROVE' | 'EDIT' | 'REJECT';
    reviewedBy?: string;
    edits?: {
      title?: string;
      decisionText?: string;
      effectiveDate?: string | null;
      dueDate?: string | null;
      ownerId?: string | null;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH';
      rationale?: string;
    };
  }
): Promise<ApprovalOutcome> {
  const approval = db.prepare(`SELECT * FROM approval_items WHERE id = ?`).get(params.approvalId) as
    | ApprovalItem
    | undefined;

  if (!approval) {
    throw new Error('Approval item not found.');
  }

  if (approval.status !== 'PENDING') {
    throw new Error(`Approval item has already been reviewed (${approval.status}).`);
  }

  const nextApprovalStatus =
    params.decision === 'REJECT' ? 'REJECTED' : params.decision === 'EDIT' ? 'EDITED' : 'APPROVED';

  let supersededDecisionId: string | null = null;
  let activatedDecisionId: string | null = null;
  const affectedItems: Array<{ type: string; id: string; title: string; warning: string }> = [];
  let summaryMessage = '';

  db.transaction(() => {
    db.prepare(
      `UPDATE approval_items SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(nextApprovalStatus, params.reviewedBy ?? null, approval.id);

    if (approval.item_type === 'DECISION') {
      const proposedDec = db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(approval.reference_id) as
        | Decision
        | undefined;

      if (!proposedDec) {
        throw new Error('Referenced decision not found.');
      }

      if (params.decision === 'REJECT') {
        db.prepare(`UPDATE decisions SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(
          proposedDec.id
        );
        db.prepare(
          `UPDATE conflicts SET status = 'DISMISSED', resolved_at = datetime('now') WHERE new_item_id = ? AND status = 'OPEN'`
        ).run(proposedDec.id);

        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_REJECTED', 'DECISION', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          approval.team_id,
          params.reviewedBy ?? null,
          proposedDec.id,
          `Rejected proposed decision "${proposedDec.topic}: ${proposedDec.decision_text}". Existing organizational memory preserved.`,
          JSON.stringify({ approvalId: approval.id })
        );
        summaryMessage = `Proposed change for "${proposedDec.topic}" was rejected. Existing active decision remains unchanged.`;
      } else {
        // Apply human edits if provided
        const finalDecisionText = params.edits?.decisionText ?? proposedDec.decision_text;
        const finalEffectiveDate =
          params.edits?.effectiveDate !== undefined ? params.edits.effectiveDate : proposedDec.effective_date;
        const finalOwnerId =
          params.edits?.ownerId !== undefined ? params.edits.ownerId : proposedDec.owner_id;
        const finalOwnerName =
          params.edits?.ownerId !== undefined
            ? finalOwnerId
              ? ((db.prepare(`SELECT name FROM users WHERE id = ?`).get(finalOwnerId) as { name: string } | undefined)?.name ?? null)
              : null
            : proposedDec.owner_name ?? null;
        const finalRationale =
          params.edits?.rationale !== undefined ? params.edits.rationale : proposedDec.rationale;

        // Find active decision(s) on the same topic to supersede cleanly
        const activeMatches = db
          .prepare(
            `SELECT * FROM decisions
             WHERE team_id = ? AND status = 'ACTIVE' AND id != ?
               AND (LOWER(topic) = LOWER(?) OR LOWER(topic) LIKE '%' || LOWER(?) || '%' OR LOWER(?) LIKE '%' || LOWER(topic) || '%')`
          )
          .all(approval.team_id, proposedDec.id, proposedDec.topic, proposedDec.topic, proposedDec.topic) as Decision[];

        const previousActive = activeMatches[0] ?? null;
        if (previousActive) {
          supersededDecisionId = previousActive.id;

          // Mark old decision SUPERSEDED (never overwrite history)
          db.prepare(`UPDATE decisions SET status = 'SUPERSEDED', updated_at = datetime('now') WHERE id = ?`).run(
            previousActive.id
          );

          // Record version update on previous decision
          const maxVerRow = db
            .prepare(`SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM decision_versions WHERE decision_id = ?`)
            .get(previousActive.id) as { max_ver: number };

          db.prepare(
            `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
             VALUES (?, ?, ?, ?, ?, 'SUPERSEDED', ?, ?, datetime('now'))`
          ).run(
            randomUUID(),
            previousActive.id,
            maxVerRow.max_ver + 1,
            previousActive.decision_text,
            previousActive.effective_date,
            proposedDec.meeting_id,
            proposedDec.source_segment_id
          );

          // Re-point active dependencies targeting the superseded decision so lineage & monitoring stay intact
          db.prepare(
            `UPDATE dependencies SET target_id = ? WHERE team_id = ? AND target_type = 'DECISION' AND target_id = ?`
          ).run(proposedDec.id, approval.team_id, previousActive.id);

          db.prepare(
            `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
             VALUES (?, ?, ?, 'DECISION_SUPERSEDED', 'DECISION', ?, ?, ?, datetime('now'))`
          ).run(
            randomUUID(),
            approval.team_id,
            params.reviewedBy ?? null,
            previousActive.id,
            `Superseded "${previousActive.decision_text}" (${previousActive.effective_date ?? 'N/A'}) with "${finalDecisionText}" (${finalEffectiveDate ?? 'N/A'}).`,
            JSON.stringify({ supersededBy: proposedDec.id, approvalId: approval.id })
          );
        }

        // Promote new decision to ACTIVE
        db.prepare(
          `UPDATE decisions
           SET decision_text = ?, effective_date = ?, owner_id = ?, owner_name = ?, rationale = ?,
               status = 'ACTIVE', is_proposal = 0, supersedes_decision_id = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          finalDecisionText,
          finalEffectiveDate,
          finalOwnerId,
          finalOwnerName,
          finalRationale,
          supersededDecisionId,
          proposedDec.id
        );
        activatedDecisionId = proposedDec.id;

        const maxNewVer = db
          .prepare(`SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM decision_versions WHERE decision_id = ?`)
          .get(proposedDec.id) as { max_ver: number };

        db.prepare(
          `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          proposedDec.id,
          maxNewVer.max_ver + 1,
          finalDecisionText,
          finalEffectiveDate,
          proposedDec.meeting_id,
          proposedDec.source_segment_id
        );

        // Resolve associated conflict records for this decision change
        db.prepare(
          `UPDATE conflicts SET status = 'RESOLVED', resolved_at = datetime('now') WHERE new_item_id = ? AND status = 'OPEN'`
        ).run(proposedDec.id);

        // Re-evaluate affected dependencies & tasks
        const deps = getStructuredDependencies(db, approval.team_id).filter(
          (dep) =>
            (dep.target_type === 'DECISION' && dep.target_id === proposedDec.id) ||
            (dep.source_type === 'DECISION' && dep.source_id === proposedDec.id)
        );

        for (const dep of deps) {
          if (dep.source_type === 'ACTION_ITEM' && dep.source_date && finalEffectiveDate && finalEffectiveDate < dep.source_date) {
            affectedItems.push({
              type: 'ACTION_ITEM',
              id: dep.source_id,
              title: dep.source_title ?? 'Prerequisite action',
              warning: `Scheduled for ${dep.source_date}, which is after the new active date (${finalEffectiveDate}). Needs acceleration or rescheduling.`,
            });
          }
        }

        // Also identify open action items from the same meeting or topic
        const relatedActions = db
          .prepare(
            `SELECT id, title, due_date FROM action_items WHERE team_id = ? AND meeting_id = ? AND status IN ('PROPOSED', 'OPEN', 'APPROVED')`
          )
          .all(approval.team_id, proposedDec.meeting_id) as Array<{ id: string; title: string; due_date: string | null }>;

        for (const ra of relatedActions) {
          if (!affectedItems.some((item) => item.id === ra.id)) {
            affectedItems.push({
              type: 'ACTION_ITEM',
              id: ra.id,
              title: ra.title,
              warning: `Execution item linked to updated decision${ra.due_date ? ` (due ${ra.due_date})` : ''}.`,
            });
          }
        }

        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_GRANTED', 'DECISION', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          approval.team_id,
          params.reviewedBy ?? null,
          proposedDec.id,
          `Approved decision update: "${proposedDec.topic}" is now ACTIVE (${finalEffectiveDate ?? 'no date'}). ${affectedItems.length} dependent/related item(s) identified.`,
          JSON.stringify({ approvalId: approval.id, supersededDecisionId, affectedItemsCount: affectedItems.length })
        );

        summaryMessage = `${finalEffectiveDate ? `${finalEffectiveDate} (${proposedDec.topic})` : proposedDec.topic} is now active.${affectedItems.length > 0 ? ` ${affectedItems.length} dependent or linked item(s) may be affected.` : ''}`;
      }
    } else if (approval.item_type === 'ACTION_ITEM') {
      const action = db.prepare(`SELECT * FROM action_items WHERE id = ?`).get(approval.reference_id) as
        | ActionItem
        | undefined;
      if (!action) {
        throw new Error('Referenced action item not found.');
      }

      if (params.decision === 'REJECT') {
        db.prepare(`UPDATE action_items SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(
          action.id
        );
        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_REJECTED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          approval.team_id,
          params.reviewedBy ?? null,
          action.id,
          `Rejected proposed action "${action.title}".`,
          JSON.stringify({ approvalId: approval.id })
        );
        summaryMessage = `Action "${action.title}" rejected and cancelled.`;
      } else {
        const finalTitle = params.edits?.title ?? action.title;
        const finalDueDate = params.edits?.dueDate !== undefined ? params.edits.dueDate : action.due_date;
        const finalOwnerId = params.edits?.ownerId !== undefined ? params.edits.ownerId : action.owner_id;
        const finalOwnerName =
          params.edits?.ownerId !== undefined
            ? finalOwnerId
              ? ((db.prepare(`SELECT name FROM users WHERE id = ?`).get(finalOwnerId) as { name: string } | undefined)?.name ?? null)
              : null
            : action.owner_name ?? null;
        const finalPriority = params.edits?.priority ?? action.priority;
        const isOpenLoop = (finalOwnerId || finalOwnerName) && finalDueDate ? 0 : action.is_open_loop;

        db.prepare(
          `UPDATE action_items
           SET title = ?, due_date = ?, owner_id = ?, owner_name = ?, priority = ?, is_open_loop = ?, status = 'APPROVED', updated_at = datetime('now')
           WHERE id = ?`
        ).run(finalTitle, finalDueDate, finalOwnerId, finalOwnerName, finalPriority, isOpenLoop, action.id);

        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_GRANTED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          approval.team_id,
          params.reviewedBy ?? null,
          action.id,
          `Approved action item "${finalTitle}" for execution.`,
          JSON.stringify({ approvalId: approval.id })
        );
        summaryMessage = `Action "${finalTitle}" is approved and ready for GitHub execution.`;
      }
    }
  })();

  // Update semantic memory for activated decision outside SQLite transaction (async)
  if (activatedDecisionId) {
    const d = db
      .prepare(
        `SELECT d.*, COALESCE(u.name, d.owner_name) AS owner_name, m.title AS meeting_title, m.meeting_date AS meeting_date
         FROM decisions d
         LEFT JOIN users u ON u.id = d.owner_id
         LEFT JOIN meetings m ON m.id = d.meeting_id
         WHERE d.id = ?`
      )
      .get(activatedDecisionId) as Decision | undefined;

    if (d) {
      await upsertMemoryRecord(db, {
        teamId: d.team_id,
        sourceType: 'DECISION',
        sourceId: d.id,
        content: `ACTIVE Decision: ${d.topic} — ${d.decision_text} (effective ${d.effective_date ?? 'N/A'}). Owner: ${d.owner_name ?? 'Unassigned'}. Meeting: ${d.meeting_title ?? ''} (${d.meeting_date ?? ''}).`,
        metadata: {
          meetingId: d.meeting_id,
          meetingTitle: d.meeting_title,
          meetingDate: d.meeting_date,
          status: d.status,
        },
      });
    }
  }

  if (supersededDecisionId) {
    const oldD = db
      .prepare(
        `SELECT d.*, m.title AS meeting_title, m.meeting_date AS meeting_date
         FROM decisions d
         LEFT JOIN meetings m ON m.id = d.meeting_id
         WHERE d.id = ?`
      )
      .get(supersededDecisionId) as Decision | undefined;
    if (oldD) {
      await upsertMemoryRecord(db, {
        teamId: oldD.team_id,
        sourceType: 'DECISION',
        sourceId: oldD.id,
        content: `SUPERSEDED Decision: ${oldD.topic} — ${oldD.decision_text} (effective ${oldD.effective_date ?? 'N/A'}). Replaced by newer active decision.`,
        metadata: {
          meetingId: oldD.meeting_id,
          meetingTitle: oldD.meeting_title,
          meetingDate: oldD.meeting_date,
          status: 'SUPERSEDED',
        },
      });
    }
  }

  evaluateReminders(db, approval.team_id);

  const updatedApproval = db.prepare(`SELECT * FROM approval_items WHERE id = ?`).get(approval.id) as ApprovalItem;
  return {
    approval: updatedApproval,
    message: summaryMessage,
    supersededDecisionId,
    activatedDecisionId,
    affectedItems,
  };
}
