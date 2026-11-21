import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { generateContentResilient, isGeminiConfigured } from '../ai/client.ts';
import { getCurrentIsoDate } from './followup-agent.ts';
import type {
  ActionItem,
  Conflict,
  Decision,
  Reminder,
  User,
  WeeklyDigest,
  WeeklyDigestContent,
} from '../../src/types/decisionflow.ts';

export async function generateWeeklyDigestForUser(
  db: Database.Database,
  params: {
    teamId: string;
    userId: string;
    referenceDate?: string;
  }
): Promise<WeeklyDigest> {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(params.userId) as User | undefined;
  if (!user) {
    throw new Error('User not found.');
  }

  const today = getCurrentIsoDate(params.referenceDate);
  const weekStartDate = new Date(`${today}T00:00:00Z`);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = today;

  const userActions = db
    .prepare(
      `SELECT a.*, m.title AS meeting_title, m.meeting_date AS meeting_date
       FROM action_items a
       LEFT JOIN meetings m ON m.id = a.meeting_id
       WHERE a.team_id = ? AND a.owner_id = ?
       ORDER BY COALESCE(a.due_date, '9999-12-31') ASC`
    )
    .all(params.teamId, params.userId) as ActionItem[];

  const teamOpenLoops = db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM action_items a
       LEFT JOIN meetings m ON m.id = a.meeting_id
       WHERE a.team_id = ? AND a.is_open_loop = 1 AND a.status NOT IN ('COMPLETED', 'CANCELLED')`
    )
    .all(params.teamId) as ActionItem[];

  const reminders = db
    .prepare(
      `SELECT r.*, a.title AS action_title, a.due_date AS due_date, a.status AS action_status
       FROM reminders r
       JOIN action_items a ON a.id = r.action_item_id
       WHERE r.team_id = ? AND (r.user_id = ? OR r.user_id IS NULL)
         AND a.status NOT IN ('COMPLETED', 'CANCELLED')`
    )
    .all(params.teamId, params.userId) as Reminder[];

  const decisions = db
    .prepare(
      `SELECT d.*, COALESCE(u.name, d.owner_name) AS owner_name
       FROM decisions d
       LEFT JOIN users u ON u.id = d.owner_id
       WHERE d.team_id = ? AND d.status IN ('ACTIVE', 'SUPERSEDED', 'PROPOSED')
       ORDER BY d.updated_at DESC`
    )
    .all(params.teamId) as Decision[];

  const openConflicts = db
    .prepare(`SELECT * FROM conflicts WHERE team_id = ? AND status = 'OPEN' ORDER BY created_at DESC`)
    .all(params.teamId) as Conflict[];

  const needsAttention: WeeklyDigestContent['needsAttention'] = [];
  const atRisk: WeeklyDigestContent['atRisk'] = [];
  const completed: WeeklyDigestContent['completed'] = [];

  for (const act of userActions) {
    if (act.status === 'COMPLETED') {
      completed.push({
        title: act.title,
        completedAt: act.updated_at.slice(0, 10),
      });
      continue;
    }

    if (act.status === 'CANCELLED' || act.status === 'REJECTED' as unknown) {
      continue;
    }

    const matchingReminder = reminders.find((r) => r.action_item_id === act.id);
    if (act.status === 'OVERDUE' || matchingReminder?.reminder_type === 'OVERDUE' || matchingReminder?.reminder_type === 'AT_RISK') {
      atRisk.push({
        title: act.title,
        dueDate: act.due_date,
        reason: matchingReminder?.message ?? `Status is ${act.status} with deadline ${act.due_date ?? 'unspecified'}.`,
        actionId: act.id,
      });
    }

    if (act.status === 'OPEN' || act.status === 'IN_PROGRESS' || act.status === 'APPROVED' || act.status === 'OVERDUE') {
      needsAttention.push({
        title: act.title,
        dueDate: act.due_date,
        status: act.status,
        reason: matchingReminder?.message ?? (act.due_date ? `Due ${act.due_date}` : 'No deadline assigned'),
        actionId: act.id,
      });
    }
  }

  // Track decision lineage (ACTIVE decisions + any SUPERSEDED predecessor)
  const decisionsAffectingYou: WeeklyDigestContent['decisionsAffectingYou'] = [];
  for (const dec of decisions) {
    if (dec.status === 'ACTIVE' || dec.status === 'PROPOSED') {
      const prev = dec.supersedes_decision_id
        ? decisions.find((x) => x.id === dec.supersedes_decision_id)
        : undefined;
      decisionsAffectingYou.push({
        topic: dec.topic,
        summary: prev
          ? `${dec.topic} moved (${prev.effective_date ?? 'previous'} -> ${dec.effective_date ?? 'current'})`
          : dec.decision_text,
        status: dec.status,
        previousDate: prev?.effective_date ?? null,
        currentDate: dec.effective_date ?? null,
        decisionId: dec.id,
      });
    }
  }

  const openLoops: WeeklyDigestContent['openLoops'] = teamOpenLoops.map((loop) => ({
    title: loop.title,
    reason: loop.open_loop_reason || 'Owner or deadline not confirmed',
    meetingTitle: loop.meeting_title ?? 'Recent meeting',
  }));

  const unresolvedConflicts: WeeklyDigestContent['unresolvedConflicts'] = openConflicts.map((c) => ({
    explanation: c.explanation,
    severity: c.severity,
    conflictId: c.id,
  }));

  // Synthesize factual narrative summary via Gemini if configured, else deterministic summary
  let summary = `${user.name} has ${needsAttention.length} active item(s), ${atRisk.length} at-risk item(s), and ${completed.length} completed task(s). ${decisionsAffectingYou.length} organizational decision(s) and ${unresolvedConflicts.length} open conflict(s) are tracked.`;

  if (isGeminiConfigured()) {
    try {
      const resp = await generateContentResilient({
        contents: `Write a crisp 2-3 sentence executive weekly execution summary for ${user.name} (${user.role}) strictly from these verified database facts. Do not invent any facts.\n\nFacts:\n${JSON.stringify({
          needsAttention,
          atRisk,
          decisionsAffectingYou,
          openLoops,
          completed,
          unresolvedConflicts,
        })}`,
        config: {
          systemInstruction:
            'You are DecisionFlow Digest Agent. Write calm, factual executive prose summarizing real execution state, changed decisions, risks, and open loops.',
        },
      });
      if (resp.text?.trim()) {
        summary = resp.text.trim();
      }
    } catch (err) {
      console.error('Digest summary synthesis error:', err);
    }
  }

  const content: WeeklyDigestContent = {
    summary,
    needsAttention,
    atRisk,
    decisionsAffectingYou,
    openLoops,
    completed,
    unresolvedConflicts,
  };

  const digestId = randomUUID();
  db.prepare(
    `INSERT INTO weekly_digests (id, team_id, user_id, week_start, week_end, content, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(digestId, params.teamId, params.userId, weekStart, weekEnd, JSON.stringify(content));

  db.prepare(
    `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
     VALUES (?, ?, ?, 'DIGEST_GENERATED', 'WEEKLY_DIGEST', ?, ?, ?, datetime('now'))`
  ).run(
    randomUUID(),
    params.teamId,
    params.userId,
    digestId,
    `Generated weekly execution digest for ${user.name}.`,
    JSON.stringify({ weekStart, weekEnd })
  );

  return {
    id: digestId,
    team_id: params.teamId,
    user_id: params.userId,
    user_name: user.name,
    week_start: weekStart,
    week_end: weekEnd,
    content,
    generated_at: new Date().toISOString(),
  };
}
