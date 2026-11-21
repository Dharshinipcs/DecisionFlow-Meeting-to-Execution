import express, { type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  ApprovalDecisionRequestSchema,
  CreateGitHubIssueRequestSchema,
  CreateMeetingRequestSchema,
  GenerateDigestRequestSchema,
  MemoryQueryRequestSchema,
  ResolveConflictSchema,
  UpdateTaskStatusSchema,
} from '../validation/schemas.ts';
import { ACME_TEAM_ID, MEETING_3_SAMPLE, resetAndSeedDemoWorkspace } from '../db/seed.ts';
import {
  GeminiUnavailableError,
  isGeminiConfigured,
  sanitizeGeminiErrorMessage,
} from '../ai/client.ts';
import { getGitHubConfigStatus } from '../github/issues.ts';
import { handleHumanApproval, processMeetingPipeline } from '../agents/approval-service.ts';
import { extractParticipantsFromSegments } from '../agents/meeting-agent.ts';
import { executeApprovedActionToGitHub, GovernanceError, syncExternalTaskWithGitHub } from '../agents/execution-agent.ts';
import { evaluateReminders } from '../agents/followup-agent.ts';
import { generateWeeklyDigestForUser } from '../agents/digest-agent.ts';
import { runAskMemoryAgent } from '../agents/memory-qa-agent.ts';
import { getStructuredActions, getStructuredDecisions, getStructuredDependencies } from '../memory/retrieval.ts';
import type {
  ActionItem,
  ApprovalItem,
  AuditEvent,
  Conflict,
  DashboardPayload,
  Decision,
  DecisionVersion,
  ExternalTask,
  Meeting,
  Team,
  TranscriptSegment,
  User,
  WeeklyDigest,
} from '../../src/types/decisionflow.ts';

function enrichConflicts(db: Database.Database, teamId: string, rows: Conflict[]): Conflict[] {
  const deps = getStructuredDependencies(db, teamId);

  return rows.map((c) => {
    let existingSummary = '';
    let existingDate: string | null = null;
    let existingQuote: string | null = null;
    let existingSpeaker: string | null = null;
    let existingMeetingTitle: string | null = null;
    let existingMeetingDate: string | null = null;

    if (c.existing_item_type === 'DECISION') {
      const d = db
        .prepare(
          `SELECT d.topic, d.decision_text, d.effective_date, ts.text AS quote, ts.speaker_name AS speaker, m.title AS meeting_title, m.meeting_date
           FROM decisions d
           LEFT JOIN transcript_segments ts ON ts.id = d.source_segment_id
           LEFT JOIN meetings m ON m.id = d.meeting_id
           WHERE d.id = ?`
        )
        .get(c.existing_item_id) as
        | {
            topic: string;
            decision_text: string;
            effective_date: string | null;
            quote: string | null;
            speaker: string | null;
            meeting_title: string | null;
            meeting_date: string | null;
          }
        | undefined;
      if (d) {
        existingSummary = `${d.topic}: ${d.decision_text}`;
        existingDate = d.effective_date;
        existingQuote = d.quote;
        existingSpeaker = d.speaker;
        existingMeetingTitle = d.meeting_title;
        existingMeetingDate = d.meeting_date;
      }
    } else if (c.existing_item_type === 'ACTION_ITEM') {
      const a = db
        .prepare(
          `SELECT a.title, a.due_date, ts.text AS quote, ts.speaker_name AS speaker, m.title AS meeting_title, m.meeting_date
           FROM action_items a
           LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
           LEFT JOIN meetings m ON m.id = a.meeting_id
           WHERE a.id = ?`
        )
        .get(c.existing_item_id) as
        | {
            title: string;
            due_date: string | null;
            quote: string | null;
            speaker: string | null;
            meeting_title: string | null;
            meeting_date: string | null;
          }
        | undefined;
      if (a) {
        existingSummary = a.title;
        existingDate = a.due_date;
        existingQuote = a.quote;
        existingSpeaker = a.speaker;
        existingMeetingTitle = a.meeting_title;
        existingMeetingDate = a.meeting_date;
      }
    }

    let newSummary = '';
    let newDate: string | null = null;
    let newQuote: string | null = null;
    let newSpeaker: string | null = null;

    if (c.new_item_type === 'DECISION') {
      const d = db
        .prepare(
          `SELECT d.topic, d.decision_text, d.effective_date, ts.text AS quote, ts.speaker_name AS speaker
           FROM decisions d
           LEFT JOIN transcript_segments ts ON ts.id = d.source_segment_id
           WHERE d.id = ?`
        )
        .get(c.new_item_id) as
        | {
            topic: string;
            decision_text: string;
            effective_date: string | null;
            quote: string | null;
            speaker: string | null;
          }
        | undefined;
      if (d) {
        newSummary = `${d.topic}: ${d.decision_text}`;
        newDate = d.effective_date;
        newQuote = d.quote;
        newSpeaker = d.speaker;
      }
    } else {
      const a = db
        .prepare(
          `SELECT a.title, a.due_date, ts.text AS quote, ts.speaker_name AS speaker
           FROM action_items a
           LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
           WHERE a.id = ?`
        )
        .get(c.new_item_id) as
        | { title: string; due_date: string | null; quote: string | null; speaker: string | null }
        | undefined;
      if (a) {
        newSummary = a.title;
        newDate = a.due_date;
        newQuote = a.quote;
        newSpeaker = a.speaker;
      }
    }

    const relatedDeps = deps.filter(
      (dep) =>
        dep.target_id === c.existing_item_id ||
        dep.target_id === c.new_item_id ||
        dep.source_id === c.existing_item_id ||
        dep.source_id === c.new_item_id
    );

    return {
      ...c,
      existing_summary: existingSummary,
      existing_date: existingDate,
      existing_quote: existingQuote,
      existing_speaker: existingSpeaker,
      existing_meeting_title: existingMeetingTitle,
      existing_meeting_date: existingMeetingDate,
      new_summary: newSummary,
      new_date: newDate,
      new_quote: newQuote,
      new_speaker: newSpeaker,
      related_dependencies: relatedDeps,
    };
  });
}

function enrichActions(db: Database.Database, actions: ActionItem[]): ActionItem[] {
  return actions.map((a) => {
    const approval = db
      .prepare(`SELECT id, status FROM approval_items WHERE item_type = 'ACTION_ITEM' AND reference_id = ?`)
      .get(a.id) as { id: string; status: ApprovalItem['status'] } | undefined;

    const ext = db
      .prepare(`SELECT * FROM external_tasks WHERE action_item_id = ?`)
      .get(a.id) as ExternalTask | undefined;

    return {
      ...a,
      approval_id: approval?.id ?? null,
      approval_status: approval?.status ?? null,
      external_task: ext ?? null,
    };
  });
}

export function createApiRouter(db: Database.Database): express.Router {
  const router = express.Router();

  router.get('/health', async (req: Request, res: Response) => {
    const gh = getGitHubConfigStatus();
    if (req.query.probe === '1' && isGeminiConfigured()) {
      const t0 = Date.now();
      try {
        const { getGeminiClient, generateContentResilient, getEmbeddingModel } = await import('../ai/client.ts');
        const ai = getGeminiClient();
        const modelOverride = typeof req.query.model === 'string' ? req.query.model : undefined;
        const r = await generateContentResilient({
          model: modelOverride,
          contents: 'Reply with OK',
        });
        const t1 = Date.now();
        let embedDims = 0;
        let embedError: string | null = null;
        try {
          const emb = await ai.models.embedContent({
            model: getEmbeddingModel(),
            contents: 'Payment launch',
          });
          embedDims = emb.embeddings?.[0]?.values?.length ?? 0;
        } catch (embErr) {
          embedError = (embErr as Error).message;
        }
        const t2 = Date.now();
        res.json({
          ok: true,
          geminiConfigured: true,
          probe: {
            textMs: t1 - t0,
            embedMs: t2 - t1,
            textSample: r.text?.trim(),
            embedDims,
            embedError,
          },
        });
        return;
      } catch (err) {
        res.status(500).json({
          ok: false,
          geminiConfigured: true,
          probeError: (err as Error).message,
          elapsedMs: Date.now() - t0,
        });
        return;
      }
    }
    res.json({
      ok: true,
      geminiConfigured: isGeminiConfigured(),
      githubConfigured: gh.configured,
      githubRepo: gh.configured ? `${gh.owner}/${gh.repo}` : null,
      githubMissingVars: gh.missingVars,
    });
  });

  router.get('/demo/sample-meeting-3', (_req: Request, res: Response) => {
    res.json(MEETING_3_SAMPLE);
  });

  router.post('/demo/reset', (_req: Request, res: Response) => {
    resetAndSeedDemoWorkspace(db);
    evaluateReminders(db, ACME_TEAM_ID);
    res.json({ ok: true, message: 'Acme Product Team demo workspace reset to initial state.' });
  });

  router.get('/dashboard', (req: Request, res: Response) => {
    const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(ACME_TEAM_ID) as Team;
    const users = db
      .prepare(
        `SELECT u.* FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? ORDER BY u.name ASC`
      )
      .all(ACME_TEAM_ID) as User[];

    const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const currentUser =
      users.find((u) => u.id === requestedUserId) ??
      users.find((u) => u.email === 'priya@acme.dev') ??
      users[0];

    const reminders = evaluateReminders(db, ACME_TEAM_ID);
    const allDecisions = getStructuredDecisions(db, ACME_TEAM_ID);
    const activeDecisions = allDecisions.filter((d) => d.status === 'ACTIVE');
    const allActions = enrichActions(db, getStructuredActions(db, ACME_TEAM_ID));
    const openConflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db
        .prepare(
          `SELECT c.*, m.title AS meeting_title
           FROM conflicts c
           JOIN meetings m ON m.id = c.meeting_id
           WHERE c.team_id = ? AND c.status = 'OPEN'
           ORDER BY c.created_at DESC`
        )
        .all(ACME_TEAM_ID) as Conflict[]
    );

    const pendingApprovalsCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM approval_items WHERE team_id = ? AND status = 'PENDING'`).get(ACME_TEAM_ID) as {
        cnt: number;
      }
    ).cnt;

    const myTasks = allActions.filter(
      (a) => a.owner_id === currentUser.id && !['COMPLETED', 'CANCELLED'].includes(a.status)
    );

    const needsAttention: DashboardPayload['needsAttention'] = [];
    for (const c of openConflicts) {
      needsAttention.push({
        id: `conflict-${c.id}`,
        kind: 'CONFLICT',
        title: c.new_summary || c.conflict_type.replace('_', ' '),
        subtitle: c.explanation,
        severity: c.severity,
        href: '/conflicts',
      });
    }

    for (const r of reminders) {
      needsAttention.push({
        id: `rem-${r.id}`,
        kind: 'REMINDER',
        title: r.action_title ?? 'Upcoming deadline',
        subtitle: r.message,
        severity: r.reminder_type === 'OVERDUE' || r.reminder_type === 'AT_RISK' ? 'HIGH' : 'MEDIUM',
        href: '/tasks',
      });
    }

    const recentMeetings = db
      .prepare(
        `SELECT m.*,
                (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id) AS decision_count,
                (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id) AS action_count,
                (SELECT COUNT(*) FROM conflicts c WHERE c.meeting_id = m.id AND c.status = 'OPEN') AS conflict_count
         FROM meetings m
         WHERE m.team_id = ?
         ORDER BY m.meeting_date DESC, m.created_at DESC
         LIMIT 6`
      )
      .all(ACME_TEAM_ID) as Meeting[];

    const recentAudit = db
      .prepare(
        `SELECT ae.*, u.name AS user_name
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.user_id
         WHERE ae.team_id = ?
         ORDER BY ae.created_at DESC
         LIMIT 10`
      )
      .all(ACME_TEAM_ID)
      .map((row: unknown) => {
        const r = row as AuditEvent & { metadata: string | null };
        return {
          ...r,
          metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
        };
      });

    const payload: DashboardPayload = {
      team,
      currentUser,
      users,
      metrics: {
        activeDecisions: activeDecisions.length,
        openConflicts: openConflicts.length,
        pendingApprovals: pendingApprovalsCount,
        myTasks: myTasks.length,
        atRiskCount: reminders.filter((r) => r.reminder_type === 'AT_RISK' || r.reminder_type === 'OVERDUE').length,
      },
      needsAttention: needsAttention.slice(0, 8),
      upcomingDeadlines: allActions
        .filter((a) => !['COMPLETED', 'CANCELLED'].includes(a.status) && a.due_date)
        .slice(0, 6),
      recentMeetings,
      recentDecisions: allDecisions.slice(0, 6),
      reminders,
      recentAudit,
      githubConfigured: getGitHubConfigStatus().configured,
    };

    res.json(payload);
  });

  // ---- Meetings ----
  router.get('/meetings', (_req: Request, res: Response) => {
    const meetings = db
      .prepare(
        `SELECT m.*,
                (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id) AS decision_count,
                (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id) AS action_count,
                (SELECT COUNT(*) FROM conflicts c WHERE c.meeting_id = m.id AND c.status = 'OPEN') AS conflict_count
         FROM meetings m
         WHERE m.team_id = ?
         ORDER BY m.meeting_date DESC, m.created_at DESC`
      )
      .all(ACME_TEAM_ID) as Meeting[];
    res.json({ meetings });
  });

  router.post('/meetings', (req: Request, res: Response) => {
    const parsed = CreateMeetingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    const { title, meetingDate, sourceType, sourceFileName, transcript } = parsed.data;
    const teamId = parsed.data.teamId ?? ACME_TEAM_ID;
    const meetingId = randomUUID();

    db.prepare(
      `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, source_file_name, raw_transcript, processing_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOADED', datetime('now'), datetime('now'))`
    ).run(meetingId, teamId, title, meetingDate, sourceType, sourceFileName ?? null, transcript);

    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, NULL, 'MEETING_UPLOADED', 'MEETING', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      teamId,
      meetingId,
      `Uploaded transcript "${title}" (${meetingDate}).`,
      JSON.stringify({ sourceType, sourceFileName: sourceFileName ?? null })
    );

    const created = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId) as Meeting;
    res.status(201).json({ meeting: created });
  });

  router.get('/meetings/:meetingId', (req: Request, res: Response) => {
    const { meetingId } = req.params;
    const meeting = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId) as
      | (Meeting & { raw_transcript: string })
      | undefined;

    if (!meeting) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Meeting not found.' });
      return;
    }

    const segments = db
      .prepare(`SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_number ASC`)
      .all(meetingId) as TranscriptSegment[];

    const decisions = getStructuredDecisions(db, meeting.team_id).filter((d) => d.meeting_id === meetingId);
    const actions = enrichActions(
      db,
      getStructuredActions(db, meeting.team_id).filter((a) => a.meeting_id === meetingId)
    );

    const itemIds = new Set([...decisions.map((d) => d.id), ...actions.map((a) => a.id)]);
    const dependencies = getStructuredDependencies(db, meeting.team_id).filter(
      (dep) => itemIds.has(dep.source_id) || itemIds.has(dep.target_id)
    );

    const conflicts = enrichConflicts(
      db,
      meeting.team_id,
      db
        .prepare(`SELECT * FROM conflicts WHERE meeting_id = ? ORDER BY created_at DESC`)
        .all(meetingId) as Conflict[]
    );

    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE team_id = ? AND entity_id = ? ORDER BY created_at ASC`)
      .all(meeting.team_id, meetingId) as AuditEvent[];

    const participants = extractParticipantsFromSegments(segments);

    res.json({
      meeting,
      participants,
      segments,
      decisions,
      actions,
      dependencies,
      conflicts,
      audit,
    });
  });

  router.post('/meetings/:meetingId/process', async (req: Request, res: Response) => {
    const meetingId = String(req.params.meetingId);
    try {
      const result = await processMeetingPipeline(db, meetingId);
      res.json(result);
    } catch (err) {
      const message = sanitizeGeminiErrorMessage(err) || 'Failed to process meeting transcript.';
      const status =
        err instanceof GeminiUnavailableError
          ? 503
          : message.includes('not found')
            ? 404
            : message.includes('GEMINI_API_KEY') || message.includes('temporarily unavailable')
              ? 503
              : 500;
      res.status(status).json({ error: 'PROCESSING_FAILED', message });
    }
  });

  // ---- Decisions & Lineage ----
  router.get('/decisions', (_req: Request, res: Response) => {
    const decisions = getStructuredDecisions(db, ACME_TEAM_ID);
    const dependencies = getStructuredDependencies(db, ACME_TEAM_ID);
    const conflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db.prepare(`SELECT * FROM conflicts WHERE team_id = ? ORDER BY created_at DESC`).all(ACME_TEAM_ID) as Conflict[]
    );
    res.json({ decisions, dependencies, conflicts });
  });

  router.get('/decisions/:decisionId', (req: Request, res: Response) => {
    const { decisionId } = req.params;
    const all = getStructuredDecisions(db, ACME_TEAM_ID);
    const decision = all.find((d) => d.id === decisionId);
    if (!decision) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Decision not found.' });
      return;
    }

    // Build full lineage chain (predecessors and successors)
    const lineage: Decision[] = [];
    const visited = new Set<string>();
    let cursor: Decision | undefined = decision;
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      lineage.unshift(cursor);
      cursor = cursor.supersedes_decision_id
        ? all.find((d) => d.id === cursor!.supersedes_decision_id)
        : undefined;
    }

    // Check if a newer decision superseded this one
    let forward = all.find((d) => d.supersedes_decision_id === decision.id);
    while (forward && !visited.has(forward.id)) {
      visited.add(forward.id);
      lineage.push(forward);
      forward = all.find((d) => d.supersedes_decision_id === forward!.id);
    }

    const versions = db
      .prepare(
        `SELECT dv.*, m.title AS source_meeting_title, m.meeting_date AS source_meeting_date,
                ts.text AS source_quote, ts.speaker_name AS source_speaker
         FROM decision_versions dv
         JOIN meetings m ON m.id = dv.source_meeting_id
         LEFT JOIN transcript_segments ts ON ts.id = dv.source_segment_id
         WHERE dv.decision_id IN (${lineage.map(() => '?').join(',')})
         ORDER BY dv.created_at ASC, dv.version_number ASC`
      )
      .all(...lineage.map((d) => d.id)) as DecisionVersion[];

    const dependencies = getStructuredDependencies(db, ACME_TEAM_ID).filter((dep) =>
      lineage.some((d) => d.id === dep.target_id || d.id === dep.source_id)
    );

    const conflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db
        .prepare(
          `SELECT * FROM conflicts WHERE team_id = ? AND (existing_item_id = ? OR new_item_id = ?) ORDER BY created_at DESC`
        )
        .all(ACME_TEAM_ID, decisionId, decisionId) as Conflict[]
    );

    res.json({ decision, lineage, versions, dependencies, conflicts });
  });

  // ---- Conflicts & Approvals ----
  router.get('/conflicts', (_req: Request, res: Response) => {
    const raw = db
      .prepare(
        `SELECT c.*, m.title AS meeting_title
         FROM conflicts c
         JOIN meetings m ON m.id = c.meeting_id
         WHERE c.team_id = ?
         ORDER BY CASE c.status WHEN 'OPEN' THEN 1 ELSE 2 END, c.created_at DESC`
      )
      .all(ACME_TEAM_ID) as Conflict[];
    res.json({ conflicts: enrichConflicts(db, ACME_TEAM_ID, raw) });
  });

  router.patch('/conflicts/:conflictId', (req: Request, res: Response) => {
    const parsed = ResolveConflictSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    const { conflictId } = req.params;
    const existing = db.prepare(`SELECT * FROM conflicts WHERE id = ?`).get(conflictId) as Conflict | undefined;
    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Conflict not found.' });
      return;
    }

    const resolvedAt = parsed.data.status === 'OPEN' ? null : new Date().toISOString();
    db.prepare(`UPDATE conflicts SET status = ?, resolved_at = ? WHERE id = ?`).run(
      parsed.data.status,
      resolvedAt,
      conflictId
    );

    const updated = db.prepare(`SELECT * FROM conflicts WHERE id = ?`).get(conflictId) as Conflict;
    res.json({ conflict: updated });
  });

  router.get('/approvals', (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT ai.*, u.name AS reviewer_name
         FROM approval_items ai
         LEFT JOIN users u ON u.id = ai.reviewed_by
         WHERE ai.team_id = ?
         ORDER BY CASE ai.status WHEN 'PENDING' THEN 1 ELSE 2 END, ai.created_at DESC`
      )
      .all(ACME_TEAM_ID) as ApprovalItem[];

    const allDecisions = getStructuredDecisions(db, ACME_TEAM_ID);
    const allActions = enrichActions(db, getStructuredActions(db, ACME_TEAM_ID));
    const allConflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db
        .prepare(
          `SELECT c.*, m.title AS meeting_title
           FROM conflicts c
           JOIN meetings m ON m.id = c.meeting_id
           WHERE c.team_id = ?`
        )
        .all(ACME_TEAM_ID) as Conflict[]
    );

    const enriched: ApprovalItem[] = rows.map((item) => {
      const decision = item.item_type === 'DECISION' ? allDecisions.find((d) => d.id === item.reference_id) ?? null : null;
      const actionItem =
        item.item_type === 'ACTION_ITEM' ? allActions.find((a) => a.id === item.reference_id) ?? null : null;
      const conflict = allConflicts.find((c) => c.new_item_id === item.reference_id) ?? null;

      return {
        ...item,
        decision,
        action_item: actionItem,
        conflict,
      };
    });

    res.json({
      approvals: enriched,
      conflicts: allConflicts,
      users: db
        .prepare(`SELECT u.* FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? ORDER BY u.name ASC`)
        .all(ACME_TEAM_ID) as User[],
      githubConfigured: getGitHubConfigStatus().configured,
    });
  });

  router.post('/approvals', async (req: Request, res: Response) => {
    const parsed = ApprovalDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    try {
      const outcome = await handleHumanApproval(db, parsed.data);
      res.json(outcome);
    } catch (err) {
      const message = (err as Error).message || 'Approval update failed.';
      const status = message.includes('not found') ? 404 : message.includes('already been reviewed') ? 409 : 400;
      res.status(status).json({ error: 'APPROVAL_ERROR', message });
    }
  });

  // ---- Tasks & GitHub Execution ----
  router.get('/tasks', (_req: Request, res: Response) => {
    evaluateReminders(db, ACME_TEAM_ID);
    const actions = enrichActions(db, getStructuredActions(db, ACME_TEAM_ID));
    const reminders = db
      .prepare(`SELECT * FROM reminders WHERE team_id = ?`)
      .all(ACME_TEAM_ID);
    const dependencies = getStructuredDependencies(db, ACME_TEAM_ID);
    const gh = getGitHubConfigStatus();

    res.json({
      tasks: actions,
      reminders,
      dependencies,
      github: gh,
    });
  });

  router.patch('/tasks/:taskId', (req: Request, res: Response) => {
    const parsed = UpdateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    const { taskId } = req.params;
    const existing = db.prepare(`SELECT * FROM action_items WHERE id = ?`).get(taskId) as ActionItem | undefined;
    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Task not found.' });
      return;
    }

    // Governance: do not allow jumping directly from PROPOSED to IN_PROGRESS/COMPLETED unless approved or explicitly transitioned after approval
    if (existing.status === 'PROPOSED' && parsed.data.status !== 'CANCELLED') {
      const approval = db
        .prepare(`SELECT status FROM approval_items WHERE item_type = 'ACTION_ITEM' AND reference_id = ?`)
        .get(taskId) as { status: string } | undefined;
      if (approval && approval.status !== 'APPROVED' && approval.status !== 'EDITED') {
        res.status(403).json({
          error: 'APPROVAL_REQUIRED',
          message: 'Approve this proposed action in Conflicts & Approvals before moving it into active execution.',
        });
        return;
      }
    }

    db.prepare(`UPDATE action_items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      parsed.data.status,
      taskId
    );

    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, ?, 'TASK_STATUS_UPDATED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      existing.team_id,
      parsed.data.userId ?? existing.owner_id,
      existing.id,
      `Updated "${existing.title}" status from ${existing.status} to ${parsed.data.status}.`,
      JSON.stringify({ previousStatus: existing.status, newStatus: parsed.data.status })
    );

    evaluateReminders(db, existing.team_id);

    const updated = enrichActions(
      db,
      [
        db
          .prepare(
            `SELECT a.*, COALESCE(u.name, a.owner_name) AS owner_name, m.title AS meeting_title, m.meeting_date AS meeting_date
             FROM action_items a
             LEFT JOIN users u ON u.id = a.owner_id
             LEFT JOIN meetings m ON m.id = a.meeting_id
             WHERE a.id = ?`
          )
          .get(taskId) as ActionItem,
      ]
    )[0];

    res.json({ task: updated });
  });

  router.post('/github/create-issue', async (req: Request, res: Response) => {
    const parsed = CreateGitHubIssueRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    try {
      const result = await executeApprovedActionToGitHub(db, {
        actionItemId: parsed.data.actionItemId,
        approvalId: parsed.data.approvalId,
        actorUserId: parsed.data.userId,
      });
      res.status(result.alreadyExisted ? 200 : 201).json(result);
    } catch (err) {
      if (err instanceof GovernanceError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      const message = (err as Error).message || 'GitHub issue creation failed.';
      const isNotConfigured = message.includes('not configured');
      res.status(isNotConfigured ? 400 : 502).json({
        error: isNotConfigured ? 'GITHUB_NOT_CONFIGURED' : 'GITHUB_API_ERROR',
        message,
      });
    }
  });

  router.post('/tasks/:taskId/sync-github', async (req: Request, res: Response) => {
    try {
      const updated = await syncExternalTaskWithGitHub(db, String(req.params.taskId));
      res.json({ externalTask: updated });
    } catch (err) {
      if (err instanceof GovernanceError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      res.status(502).json({ error: 'GITHUB_SYNC_ERROR', message: (err as Error).message });
    }
  });

  // ---- Reminders ----
  router.get('/reminders', (_req: Request, res: Response) => {
    const reminders = evaluateReminders(db, ACME_TEAM_ID);
    res.json({ reminders });
  });

  router.post('/reminders/evaluate', (req: Request, res: Response) => {
    const referenceDate = typeof req.body?.referenceDate === 'string' ? req.body.referenceDate : undefined;
    const reminders = evaluateReminders(db, ACME_TEAM_ID, referenceDate);
    res.json({ reminders });
  });

  // ---- Weekly Digest ----
  router.get('/digest/:userId', async (req: Request, res: Response) => {
    const userId = String(req.params.userId);
    const refresh = req.query.refresh === 'true';

    if (!refresh) {
      const existing = db
        .prepare(
          `SELECT wd.*, u.name AS user_name
           FROM weekly_digests wd
           JOIN users u ON u.id = wd.user_id
           WHERE wd.team_id = ? AND wd.user_id = ?
           ORDER BY wd.generated_at DESC
           LIMIT 1`
        )
        .get(ACME_TEAM_ID, userId) as (Omit<WeeklyDigest, 'content'> & { content: string }) | undefined;

      if (existing) {
        res.json({
          digest: {
            ...existing,
            content: JSON.parse(existing.content),
          },
        });
        return;
      }
    }

    try {
      evaluateReminders(db, ACME_TEAM_ID);
      const digest = await generateWeeklyDigestForUser(db, { teamId: ACME_TEAM_ID, userId });
      res.json({ digest });
    } catch (err) {
      res.status(400).json({ error: 'DIGEST_ERROR', message: (err as Error).message });
    }
  });

  router.post('/digest', async (req: Request, res: Response) => {
    const parsed = GenerateDigestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    try {
      evaluateReminders(db, parsed.data.teamId ?? ACME_TEAM_ID);
      const digest = await generateWeeklyDigestForUser(db, {
        teamId: parsed.data.teamId ?? ACME_TEAM_ID,
        userId: parsed.data.userId,
      });
      res.json({ digest });
    } catch (err) {
      res.status(400).json({ error: 'DIGEST_ERROR', message: (err as Error).message });
    }
  });

  // ---- Ask Memory ----
  router.post('/memory', async (req: Request, res: Response) => {
    const parsed = MemoryQueryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    try {
      const answer = await runAskMemoryAgent({
        db,
        teamId: parsed.data.teamId ?? ACME_TEAM_ID,
        question: parsed.data.question,
      });
      res.json(answer);
    } catch (err) {
      const message = sanitizeGeminiErrorMessage(err) || 'Memory query failed.';
      const status =
        err instanceof GeminiUnavailableError || message.includes('GEMINI_API_KEY') || message.includes('temporarily unavailable')
          ? 503
          : 500;
      res.status(status).json({ error: 'MEMORY_QUERY_ERROR', message });
    }
  });

  // ---- Audit Events ----
  router.get('/audit', (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT ae.*, u.name AS user_name
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.user_id
         WHERE ae.team_id = ?
         ORDER BY ae.created_at DESC
         LIMIT 50`
      )
      .all(ACME_TEAM_ID)
      .map((row: unknown) => {
        const r = row as AuditEvent & { metadata: string | null };
        return {
          ...r,
          metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
        };
      });
    res.json({ events: rows });
  });

  return router;
}
