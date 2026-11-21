import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { createGitHubIssue, fetchGitHubIssueState } from '../github/issues.ts';
import type { ActionItem, ApprovalItem, ExternalTask } from '../../src/types/decisionflow.ts';

export class GovernanceError extends Error {
  statusCode: number;
  code: string;
  constructor(code: string, message: string, statusCode = 403) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Execution Agent: Turns human-approved action items into real GitHub Issues.
 * Enforces mandatory governance: approval must exist AND be APPROVED/EDITED.
 */
export async function executeApprovedActionToGitHub(
  db: Database.Database,
  params: {
    actionItemId: string;
    approvalId?: string;
    actorUserId?: string;
  }
): Promise<{ externalTask: ExternalTask; alreadyExisted: boolean }> {
  const action = db
    .prepare(
      `SELECT a.*,
              COALESCE(u.name, a.owner_name) AS owner_name,
              m.title AS meeting_title,
              m.meeting_date AS meeting_date,
              ts.text AS source_quote,
              ts.speaker_name AS source_speaker
       FROM action_items a
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN meetings m ON m.id = a.meeting_id
       LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
       WHERE a.id = ?`
    )
    .get(params.actionItemId) as ActionItem | undefined;

  if (!action) {
    throw new GovernanceError('ACTION_NOT_FOUND', 'Action item not found.', 404);
  }

  // Idempotency check: prevent duplicate GitHub issues for the same action item
  const existingTask = db
    .prepare(`SELECT * FROM external_tasks WHERE action_item_id = ?`)
    .get(action.id) as ExternalTask | undefined;
  if (existingTask) {
    return { externalTask: existingTask, alreadyExisted: true };
  }

  // CRITICAL GOVERNANCE RULE: Server-side approval verification
  const approval = (
    params.approvalId
      ? db.prepare(`SELECT * FROM approval_items WHERE id = ? AND item_type = 'ACTION_ITEM' AND reference_id = ?`).get(
          params.approvalId,
          action.id
        )
      : db.prepare(`SELECT * FROM approval_items WHERE item_type = 'ACTION_ITEM' AND reference_id = ?`).get(action.id)
  ) as ApprovalItem | undefined;

  if (!approval) {
    throw new GovernanceError(
      'APPROVAL_REQUIRED',
      'Execution blocked: No approval record exists for this action item.',
      403
    );
  }

  if (approval.status !== 'APPROVED' && approval.status !== 'EDITED') {
    throw new GovernanceError(
      'APPROVAL_NOT_GRANTED',
      `Execution blocked: Approval status is "${approval.status}". Human approval (APPROVED) is required before external execution.`,
      403
    );
  }

  // Gather active decisions context for provenance in the GitHub issue body
  const activeDecisions = db
    .prepare(`SELECT topic, decision_text, effective_date FROM decisions WHERE team_id = ? AND status = 'ACTIVE' LIMIT 5`)
    .all(action.team_id) as Array<{ topic: string; decision_text: string; effective_date: string | null }>;

  const decisionContext =
    activeDecisions.length > 0
      ? activeDecisions
          .map((d) => `- **${d.topic}**: ${d.decision_text}${d.effective_date ? ` (Effective: ${d.effective_date})` : ''}`)
          .join('\n')
      : '- None linked';

  const body = `### DecisionFlow Tracked Action

${action.description || action.title}

---

#### Execution Details
- **Owner:** ${action.owner_name ?? 'Owner not confirmed'}
- **Due Date:** ${action.due_date ?? 'No deadline set'}
- **Priority:** ${action.priority}
- **DecisionFlow Action ID:** \`${action.id}\`
- **Approval Record:** \`${approval.id}\` (${approval.status})

#### Provenance
- **Source Meeting:** ${action.meeting_title ?? 'Unknown'} (${action.meeting_date ?? ''})
- **Speaker Evidence (${action.source_speaker ?? 'Speaker'}):**
  > "${action.source_quote ?? 'Extracted from meeting transcript'}"

#### Related Active Decisions
${decisionContext}
`;

  const issue = await createGitHubIssue({
    title: action.title,
    body,
    labels: ['decisionflow', action.priority.toLowerCase()],
  });

  const externalTaskId = randomUUID();
  const mappedInternalStatus = issue.state === 'closed' ? 'COMPLETED' : 'OPEN';

  const saveTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO external_tasks (id, action_item_id, provider, external_id, external_url, external_status, created_at, updated_at)
       VALUES (?, ?, 'github', ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(externalTaskId, action.id, String(issue.issueNumber), issue.issueUrl, issue.state);

    db.prepare(`UPDATE action_items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      mappedInternalStatus,
      action.id
    );

    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, ?, 'GITHUB_TASK_CREATED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      action.team_id,
      params.actorUserId ?? approval.reviewed_by ?? action.owner_id,
      action.id,
      `Created GitHub Issue #${issue.issueNumber} for "${action.title}".`,
      JSON.stringify({
        externalId: String(issue.issueNumber),
        externalUrl: issue.issueUrl,
        approvalId: approval.id,
      })
    );
  });

  saveTx();

  const saved = db.prepare(`SELECT * FROM external_tasks WHERE id = ?`).get(externalTaskId) as ExternalTask;
  return { externalTask: saved, alreadyExisted: false };
}

export async function syncExternalTaskWithGitHub(
  db: Database.Database,
  actionItemId: string
): Promise<ExternalTask> {
  const existing = db
    .prepare(`SELECT * FROM external_tasks WHERE action_item_id = ?`)
    .get(actionItemId) as ExternalTask | undefined;

  if (!existing) {
    throw new GovernanceError('EXTERNAL_TASK_NOT_FOUND', 'No GitHub issue linked to this task.', 404);
  }

  const remote = await fetchGitHubIssueState(existing.external_id);
  const mappedStatus = remote.state === 'closed' ? 'COMPLETED' : 'OPEN';

  db.prepare(
    `UPDATE external_tasks SET external_status = ?, external_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(remote.state, remote.htmlUrl, existing.id);

  db.prepare(`UPDATE action_items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    mappedStatus,
    actionItemId
  );

  return db.prepare(`SELECT * FROM external_tasks WHERE id = ?`).get(existing.id) as ExternalTask;
}
