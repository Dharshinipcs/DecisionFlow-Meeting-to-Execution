import { useEffect, useState } from 'react';
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  GitBranch,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ApprovalItem, Conflict, User } from '../types/decisionflow';
import { formatShortDate, formatShortMonthDay, StatusTag } from '../components/StatusBadge';
import type { NavRoute } from '../components/Layout';

interface ConflictsApprovalsPageProps {
  currentUserId: string;
  onChanged: () => void;
  onOpenUpload: () => void;
  onNavigate: (route: NavRoute) => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function ConflictsApprovalsPage({
  currentUserId,
  onChanged,
  onOpenUpload,
  onNavigate,
  onToast,
}: ConflictsApprovalsPageProps) {
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [creatingIssueId, setCreatingIssueId] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [editForm, setEditForm] = useState<{
    title: string;
    decisionText: string;
    effectiveDate: string;
    dueDate: string;
    ownerId: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    rationale: string;
  }>({
    title: '',
    decisionText: '',
    effectiveDate: '',
    dueDate: '',
    ownerId: '',
    priority: 'MEDIUM',
    rationale: '',
  });

  const [lastOutcome, setLastOutcome] = useState<{
    message: string;
    affectedItems: Array<{ type: string; id: string; title: string; warning: string }>;
  } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getApprovals();
      setApprovals(data.approvals);
      setUsers(data.users);
      setGithubConfigured(data.githubConfigured);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const startEdit = (item: ApprovalItem) => {
    setEditingId(item.id);
    if (item.item_type === 'DECISION' && item.decision) {
      setEditForm({
        title: item.title,
        decisionText: item.decision.decision_text,
        effectiveDate: item.decision.effective_date ?? '',
        dueDate: '',
        ownerId: item.decision.owner_id ?? '',
        priority: 'HIGH',
        rationale: item.decision.rationale ?? '',
      });
    } else if (item.item_type === 'ACTION_ITEM' && item.action_item) {
      setEditForm({
        title: item.action_item.title,
        decisionText: '',
        effectiveDate: '',
        dueDate: item.action_item.due_date ?? '',
        ownerId: item.action_item.owner_id ?? '',
        priority: item.action_item.priority,
        rationale: '',
      });
    }
  };

  const submitDecision = async (item: ApprovalItem, decision: 'APPROVE' | 'EDIT' | 'REJECT') => {
    setSubmittingId(item.id);
    try {
      const payload: Parameters<typeof api.submitApproval>[0] = {
        approvalId: item.id,
        decision,
        reviewedBy: currentUserId,
      };
      if (decision === 'EDIT') {
        if (item.item_type === 'DECISION') {
          payload.edits = {
            decisionText: editForm.decisionText.trim() || undefined,
            effectiveDate: editForm.effectiveDate || null,
            ownerId: editForm.ownerId || null,
            rationale: editForm.rationale.trim() || undefined,
          };
        } else {
          payload.edits = {
            title: editForm.title.trim() || undefined,
            dueDate: editForm.dueDate || null,
            ownerId: editForm.ownerId || null,
            priority: editForm.priority,
          };
        }
      }

      const res = await api.submitApproval(payload);
      setLastOutcome({
        message: res.message,
        affectedItems: res.affectedItems,
      });
      setEditingId(null);
      onToast('success', res.message);
      await loadData();
      onChanged();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSubmittingId(null);
    }
  };

  const handleCreateGitHubIssue = async (actionItemId: string, approvalId: string) => {
    setCreatingIssueId(actionItemId);
    try {
      const res = await api.createGitHubIssue({
        actionItemId,
        approvalId,
        userId: currentUserId,
      });
      onToast('success', `Task created · GitHub Issue #${res.externalTask.external_id}`);
      await loadData();
      onChanged();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setCreatingIssueId(null);
    }
  };

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');
  const pendingDecisions = pendingApprovals.filter((a) => a.item_type === 'DECISION');
  const pendingActions = pendingApprovals.filter((a) => a.item_type === 'ACTION_ITEM');
  const reviewedApprovals = approvals.filter((a) => a.status !== 'PENDING');

  const renderConflictComparison = (item: ApprovalItem, conflict: Conflict) => {
    const prevDate = conflict.existing_date ? formatShortMonthDay(conflict.existing_date) : null;
    const newDate = conflict.new_date ? formatShortMonthDay(conflict.new_date) : null;
    const dep = conflict.related_dependencies?.[0];
    const evidenceOpen = Boolean(expandedEvidence[item.id]);

    return (
      <div className="space-y-4">
        {/* Clear Visual Progression: Existing Decision -> New Proposal -> Conflict -> Recommended Action */}
        <div className="rounded-md border border-seagrass-200 bg-seagrass-50/60 p-4 space-y-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-seagrass-600">Existing Decision</span>
            {conflict.existing_meeting_title && (
              <span className="text-xs text-seagrass-500">
                From {conflict.existing_meeting_title}
                {conflict.existing_meeting_date ? ` (${formatShortMonthDay(conflict.existing_meeting_date)})` : ''}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-raven-950">
            {prevDate ? `${prevDate} — ` : ''}
            {conflict.existing_summary ?? 'Existing commitment'}
          </div>

          <div className="flex justify-start pl-2 py-0.5">
            <ArrowDown className="w-3.5 h-3.5 text-seagrass-400" aria-hidden="true" />
          </div>

          <div className="rounded-md border border-apricot-200 bg-apricot-50 p-3.5 space-y-1">
            <div className="text-xs font-medium text-apricot-700">New Proposal</div>
            <div className="text-sm font-semibold text-raven-950">
              {newDate ? `${newDate} — ` : ''}
              {item.decision?.decision_text ?? item.title}
            </div>
          </div>

          <div className="flex justify-start pl-2 py-0.5">
            <ArrowDown className="w-3.5 h-3.5 text-seagrass-400" aria-hidden="true" />
          </div>

          <div className="rounded-md border border-seagrass-200 bg-white p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-apricot-700">Why it conflicts</span>
              <span className="text-xs font-mono text-seagrass-500 tabular-nums">
                {conflict.conflict_type.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-sm text-raven-950 leading-relaxed">{conflict.explanation}</p>
            {dep && (
              <div className="pt-1 text-xs text-seagrass-700 flex items-start gap-2">
                <GitBranch className="w-3.5 h-3.5 text-apricot-600 mt-0.5 shrink-0" />
                <span>
                  Prerequisite: <span className="font-medium text-raven-950">{dep.source_title}</span>
                  {dep.source_date ? ` (scheduled ${formatShortMonthDay(dep.source_date)})` : ''}
                </span>
              </div>
            )}
          </div>

          <div className="pt-1 text-xs text-seagrass-700">
            <span className="font-semibold text-raven-950">If you approve:</span>{' '}
            the existing decision becomes <span className="font-medium">Superseded</span> (kept in history), this proposal becomes <span className="font-medium">Active</span>, and linked tasks are flagged for review.
          </div>
        </div>

        {/* Concise Evidence Toggle (Progressive Disclosure) */}
        <div>
          <button
            type="button"
            onClick={() =>
              setExpandedEvidence((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
            }
            className="inline-flex items-center gap-1.5 text-xs font-medium text-raven-700 hover:text-raven-950"
          >
            {evidenceOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{evidenceOpen ? 'Hide Transcript Evidence' : 'View Evidence'}</span>
          </button>

          {evidenceOpen && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {conflict.existing_quote && (
                <div className="rounded-md border border-seagrass-200 bg-seagrass-50 p-3.5 space-y-1">
                  <div className="text-xs text-seagrass-500">
                    {conflict.existing_meeting_title ?? 'Previous Meeting'} · Speaker: {conflict.existing_speaker ?? 'Speaker'}
                  </div>
                  <p className="text-xs text-raven-950 leading-relaxed">&ldquo;{conflict.existing_quote}&rdquo;</p>
                </div>
              )}
              {(conflict.new_quote || item.decision?.source_quote) && (
                <div className="rounded-md border border-seagrass-200 bg-seagrass-50 p-3.5 space-y-1">
                  <div className="text-xs text-seagrass-500">
                    {item.decision?.meeting_title ?? conflict.meeting_title ?? 'Current Meeting'} · Speaker:{' '}
                    {conflict.new_speaker ?? item.decision?.source_speaker ?? 'Speaker'}
                  </div>
                  <p className="text-xs text-raven-950 leading-relaxed">
                    &ldquo;{conflict.new_quote ?? item.decision?.source_quote}&rdquo;
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-raven-950 font-display">Conflicts &amp; Approvals</h2>
          <p className="text-sm text-seagrass-600 mt-0.5">
            Review proposed decision changes, conflicts against organizational memory, and action items before execution.
          </p>
        </div>

        {!githubConfigured && (
          <div className="text-xs text-apricot-700 bg-apricot-50 border border-apricot-200 rounded-md px-3 py-2">
            GitHub execution requires server GitHub configuration.
          </div>
        )}
      </div>

      {/* Approval Outcome Callout */}
      {lastOutcome && (
        <div className="rounded-lg border border-raven-800 bg-raven-900 text-white p-5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-white">Decision Updated</div>
            <button
              type="button"
              onClick={() => setLastOutcome(null)}
              className="text-xs font-medium text-raven-200 hover:text-white underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
          <p className="text-sm text-raven-100">{lastOutcome.message}</p>
          {lastOutcome.affectedItems.length > 0 && (
            <div className="pt-2 border-t border-raven-800 space-y-1">
              <div className="text-xs font-medium text-apricot-300">Affected Dependent Items:</div>
              {lastOutcome.affectedItems.map((ai) => (
                <div key={ai.id} className="text-xs text-raven-200">
                  • <span className="font-medium text-white">{ai.title}</span> — {ai.warning}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-sm text-seagrass-600">Loading pending reviews…</div>
      ) : (
        <>
          {pendingApprovals.length === 0 && (
            <div className="rounded-lg border border-seagrass-200 bg-white p-8 text-center space-y-3">
              <ShieldAlert className="w-8 h-8 text-seagrass-300 mx-auto" />
              <div className="text-sm font-semibold text-raven-950 font-display">No pending approvals</div>
              <p className="text-xs text-seagrass-600 max-w-md mx-auto">
                Upload and process a meeting transcript to inspect extracted decisions, cross-meeting conflicts, and proposed tasks.
              </p>
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onOpenUpload}
                  className="px-4 py-2 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800"
                >
                  Upload Transcript
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('tasks')}
                  className="px-4 py-2 text-xs font-medium text-raven-900 bg-white border border-seagrass-300 rounded-md hover:bg-seagrass-50"
                >
                  View Tasks
                </button>
              </div>
            </div>
          )}

          {/* Pending Decision Changes & Conflicts */}
          {pendingDecisions.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-raven-950 font-display">
                Decision Proposals &amp; Conflicts ({pendingDecisions.length})
              </h3>

              {pendingDecisions.map((item) => {
                const isEditing = editingId === item.id;
                const isSubmitting = submittingId === item.id;
                const simpleEvOpen = Boolean(expandedEvidence[item.id]);

                return (
                  <article
                    key={item.id}
                    className={`rounded-lg border bg-white overflow-hidden ${
                      item.conflict ? 'border-seagrass-200 border-l-4 border-l-apricot-500' : 'border-seagrass-200'
                    }`}
                  >
                    <div className="px-6 py-4 border-b border-raven-800 flex flex-wrap items-center justify-between gap-3 bg-raven-900 text-white">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-raven-200">
                          <span className={`font-semibold ${item.conflict ? 'text-apricot-300' : 'text-raven-100'}`}>
                            {item.conflict ? 'Conflict Review Required' : 'Proposed Decision'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{item.decision?.meeting_title ?? 'Meeting'}</span>
                          <span aria-hidden="true">·</span>
                          <span>Owner: {item.decision?.owner_name ?? 'Owner not confirmed'}</span>
                        </div>
                        <h4 className="text-base font-semibold text-white mt-1 font-display">
                          {item.title}
                        </h4>
                      </div>

                      <div className="flex items-center gap-2">
                        {item.conflict && <StatusTag status={item.conflict.severity} />}
                        <StatusTag status={item.status} />
                      </div>
                    </div>

                    <div className="p-6 space-y-5">
                      {item.conflict ? (
                        renderConflictComparison(item, item.conflict)
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm text-seagrass-700 leading-relaxed">{item.description}</p>
                          {item.decision?.source_quote && (
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedEvidence((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                }
                                className="text-xs font-medium text-raven-700 hover:text-raven-950 underline underline-offset-2"
                              >
                                {simpleEvOpen ? 'Hide Evidence' : 'View Evidence'}
                              </button>
                              {simpleEvOpen && (
                                <div className="mt-2 rounded-md border border-seagrass-200 bg-seagrass-50 p-3.5 text-xs text-raven-950">
                                  <span className="font-semibold">{item.decision.source_speaker}:</span> &ldquo;
                                  {item.decision.source_quote}&rdquo;
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {isEditing && (
                        <div className="rounded-md border border-seagrass-200 bg-seagrass-50 p-4 space-y-3">
                          <div className="text-xs font-semibold text-raven-950">Edit Before Approving</div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-seagrass-700 mb-1">
                                Decision Text
                              </label>
                              <input
                                type="text"
                                value={editForm.decisionText}
                                onChange={(e) => setEditForm({ ...editForm, decisionText: e.target.value })}
                                className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-1.5 text-sm text-raven-950"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-seagrass-700 mb-1">
                                Effective Date
                              </label>
                              <input
                                type="date"
                                value={editForm.effectiveDate}
                                onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })}
                                className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-1.5 text-sm font-mono tabular-nums text-raven-950"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-seagrass-700 mb-1">Owner</label>
                            <select
                              value={editForm.ownerId}
                              onChange={(e) => setEditForm({ ...editForm, ownerId: e.target.value })}
                              className="w-full sm:w-64 rounded-md border border-seagrass-300 bg-white px-3 py-1.5 text-sm text-raven-950"
                            >
                              <option value="">Keep current / Unassigned</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Clear Human Decision Controls */}
                      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-seagrass-100">
                        <button
                          type="button"
                          onClick={() => submitDecision(item, 'REJECT')}
                          disabled={isSubmitting}
                          className="inline-flex items-center gap-1.5 rounded-md border border-seagrass-300 bg-white px-3.5 py-2 text-xs font-medium text-seagrass-700 hover:bg-seagrass-50 disabled:opacity-60"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject Change</span>
                        </button>

                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1.5 rounded-md border border-seagrass-300 bg-white px-3.5 py-2 text-xs font-medium text-raven-900 hover:bg-seagrass-50 disabled:opacity-60"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => submitDecision(item, 'EDIT')}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-4 py-2 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Save &amp; Approve Change</span>
                          </button>
                        )}

                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => submitDecision(item, 'APPROVE')}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-4 py-2 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60"
                          >
                            {isSubmitting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>Approve Change</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Pending Action Item Approvals */}
          {pendingActions.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-raven-950 font-display">
                Proposed Action Items ({pendingActions.length})
              </h3>
              <div className="rounded-lg border border-seagrass-200 bg-white divide-y divide-seagrass-100">
                {pendingActions.map((item) => {
                  const act = item.action_item;
                  const isEditing = editingId === item.id;
                  const isSubmitting = submittingId === item.id;

                  return (
                    <div key={item.id} className="p-5 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-500">
                            <span>{act?.meeting_title ?? 'Meeting'}</span>
                            <span aria-hidden="true">·</span>
                            <span className={act?.owner_name ? 'font-medium text-raven-900' : 'text-apricot-700 font-medium'}>
                              Owner: {act?.owner_name ?? 'Owner not confirmed'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {act?.due_date ? `Due ${formatShortDate(act.due_date)}` : 'No deadline'}
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-raven-950">{item.title}</div>
                          {act?.source_quote && (
                            <div className="text-xs text-seagrass-600">
                              Evidence ({act.source_speaker}): &ldquo;{act.source_quote}&rdquo;
                            </div>
                          )}
                        </div>
                        <StatusTag status={item.status} />
                      </div>

                      {isEditing && (
                        <div className="rounded-md border border-seagrass-200 bg-seagrass-50 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-seagrass-700 mb-1">Title</label>
                            <input
                              type="text"
                              value={editForm.title}
                              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                              className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-1.5 text-sm text-raven-950"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-seagrass-700 mb-1">Owner</label>
                            <select
                              value={editForm.ownerId}
                              onChange={(e) => setEditForm({ ...editForm, ownerId: e.target.value })}
                              className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-1.5 text-sm text-raven-950"
                            >
                              <option value="">Owner not confirmed</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-seagrass-700 mb-1">Due Date</label>
                            <input
                              type="date"
                              value={editForm.dueDate}
                              onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                              className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-1.5 text-sm font-mono tabular-nums text-raven-950"
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => submitDecision(item, 'REJECT')}
                          disabled={isSubmitting}
                          className="px-3 py-1.5 text-xs font-medium text-seagrass-700 bg-white border border-seagrass-300 rounded-md hover:bg-seagrass-50"
                        >
                          Reject Action
                        </button>
                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            disabled={isSubmitting}
                            className="px-3 py-1.5 text-xs font-medium text-raven-900 bg-white border border-seagrass-300 rounded-md hover:bg-seagrass-50"
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => submitDecision(item, 'EDIT')}
                            disabled={isSubmitting}
                            className="px-3.5 py-1.5 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800"
                          >
                            Save &amp; Approve
                          </button>
                        )}
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => submitDecision(item, 'APPROVE')}
                            disabled={isSubmitting}
                            className="px-3.5 py-1.5 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800"
                          >
                            Approve Action
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reviewed Approvals + GitHub Execution */}
          {reviewedApprovals.length > 0 && (
            <div className="rounded-lg border border-seagrass-200 bg-white">
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-seagrass-50/70 transition-colors"
              >
                <div>
                  <span className="text-sm font-semibold text-raven-950 font-display">
                    Reviewed Approvals &amp; GitHub Execution ({reviewedApprovals.length})
                  </span>
                  <span className="ml-2 text-xs text-seagrass-600">
                    Dispatch approved actions to GitHub Issues
                  </span>
                </div>
                {showHistory ? (
                  <ChevronUp className="w-4 h-4 text-seagrass-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-seagrass-500" />
                )}
              </button>

              {(showHistory ||
                reviewedApprovals.some(
                  (a) =>
                    a.item_type === 'ACTION_ITEM' &&
                    (a.status === 'APPROVED' || a.status === 'EDITED') &&
                    !a.action_item?.external_task
                )) && (
                <div className="border-t border-seagrass-200 divide-y divide-seagrass-100">
                  {reviewedApprovals.map((item) => {
                    const act = item.action_item;
                    const canCreateGitHub =
                      item.item_type === 'ACTION_ITEM' &&
                      (item.status === 'APPROVED' || item.status === 'EDITED') &&
                      act &&
                      !act.external_task;

                    return (
                      <div key={item.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs text-seagrass-500">
                            <span>{item.item_type === 'ACTION_ITEM' ? 'Action Item' : 'Decision'}</span>
                            <span aria-hidden="true">·</span>
                            <span>Reviewed by {item.reviewer_name ?? 'Team Lead'}</span>
                          </div>
                          <div className="text-sm font-medium text-raven-950 mt-0.5">{item.title}</div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <StatusTag status={item.status} />

                          {act?.external_task && (
                            <a
                              href={act.external_task.external_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md border border-seagrass-200 bg-seagrass-50 px-3 py-1.5 text-xs font-mono font-medium text-raven-950 hover:bg-seagrass-100"
                            >
                              <GitBranch className="w-3.5 h-3.5 text-raven-700" />
                              <span>GitHub #{act.external_task.external_id}</span>
                              <ExternalLink className="w-3 h-3 text-seagrass-500" />
                            </a>
                          )}

                          {canCreateGitHub && act && (
                            <button
                              type="button"
                              onClick={() => handleCreateGitHubIssue(act.id, item.id)}
                              disabled={creatingIssueId === act.id}
                              className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60"
                            >
                              {creatingIssueId === act.id ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Creating GitHub Issue…</span>
                                </>
                              ) : (
                                <span>Create GitHub Issue</span>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
