import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { ActionItem, Reminder } from '../../src/types/decisionflow.ts';

function daysBetween(isoFrom: string, isoTo: string): number {
  const from = new Date(`${isoFrom}T00:00:00Z`).getTime();
  const to = new Date(`${isoTo}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

export function getCurrentIsoDate(referenceDate?: string): string {
  if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return referenceDate;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function evaluateReminders(
  db: Database.Database,
  teamId: string,
  referenceDate?: string
): Reminder[] {
  const today = getCurrentIsoDate(referenceDate);

  const actions = db
    .prepare(
      `SELECT a.*, COALESCE(u.name, a.owner_name) AS owner_name
       FROM action_items a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.team_id = ?
         AND a.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')`
    )
    .all(teamId) as ActionItem[];

  const upsertReminder = db.prepare(
    `INSERT INTO reminders (id, team_id, action_item_id, user_id, reminder_type, message, scheduled_for, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'), datetime('now'))
     ON CONFLICT(action_item_id, reminder_type) DO UPDATE SET
       message = excluded.message,
       user_id = excluded.user_id,
       scheduled_for = excluded.scheduled_for`
  );

  // Check if there are open dependency conflicts referencing any actions or decisions
  const openConflicts = db
    .prepare(`SELECT existing_item_id, new_item_id, conflict_type FROM conflicts WHERE team_id = ? AND status = 'OPEN'`)
    .all(teamId) as Array<{ existing_item_id: string; new_item_id: string; conflict_type: string }>;

  const conflictedIds = new Set<string>();
  for (const c of openConflicts) {
    conflictedIds.add(c.existing_item_id);
    conflictedIds.add(c.new_item_id);
  }

  for (const action of actions) {
    // Open loop / missing owner risk (allow either linked app user or confirmed transcript owner_name)
    if (action.is_open_loop === 1 || (!action.owner_id && !action.owner_name)) {
      const reason = action.open_loop_reason || 'Owner not confirmed';
      upsertReminder.run(
        randomUUID(),
        teamId,
        action.id,
        action.owner_id,
        'AT_RISK',
        `At risk: "${action.title}" — ${reason}.`,
        today
      );
      continue;
    }

    if (!action.due_date) {
      continue;
    }

    const diff = daysBetween(today, action.due_date);

    if (diff < 0 && action.status !== 'PROPOSED') {
      // Deterministically mark overdue tasks as OVERDUE
      if (action.status !== 'OVERDUE') {
        db.prepare(`UPDATE action_items SET status = 'OVERDUE', updated_at = datetime('now') WHERE id = ?`).run(
          action.id
        );
      }
      const overdueDays = Math.abs(diff);
      upsertReminder.run(
        randomUUID(),
        teamId,
        action.id,
        action.owner_id,
        'OVERDUE',
        `Overdue by ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}: "${action.title}" (due ${action.due_date}).`,
        action.due_date
      );
    } else if (diff >= 0 && diff <= 1) {
      const whenLabel = diff === 0 ? 'today' : 'tomorrow';
      upsertReminder.run(
        randomUUID(),
        teamId,
        action.id,
        action.owner_id,
        'AT_RISK',
        `At risk: "${action.title}" is due ${whenLabel} (${action.due_date}) and is still ${action.status.toLowerCase().replace('_', ' ')}.`,
        action.due_date
      );
    } else if (diff >= 2 && diff <= 4) {
      upsertReminder.run(
        randomUUID(),
        teamId,
        action.id,
        action.owner_id,
        'UPCOMING_DEADLINE',
        `Deadline approaching in ${diff} days (${action.due_date}): "${action.title}".`,
        action.due_date
      );
    } else if (conflictedIds.has(action.id)) {
      upsertReminder.run(
        randomUUID(),
        teamId,
        action.id,
        action.owner_id,
        'AT_RISK',
        `At risk due to schedule dependency conflict: "${action.title}" (due ${action.due_date}).`,
        action.due_date
      );
    }
  }

  return db
    .prepare(
      `SELECT r.*,
              COALESCE(u.name, a.owner_name) AS user_name,
              a.title AS action_title,
              a.due_date AS due_date,
              a.status AS action_status
       FROM reminders r
       LEFT JOIN users u ON u.id = r.user_id
       JOIN action_items a ON a.id = r.action_item_id
       WHERE r.team_id = ?
         AND a.status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY
         CASE r.reminder_type WHEN 'OVERDUE' THEN 1 WHEN 'AT_RISK' THEN 2 ELSE 3 END,
         r.scheduled_for ASC`
    )
    .all(teamId) as Reminder[];
}
