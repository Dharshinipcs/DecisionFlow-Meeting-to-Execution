import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ActionItem, ActionStatus, Reminder } from '../types/decisionflow';
import { formatShortDate, StatusTag } from '../components/StatusBadge';

interface TasksPageProps {
  currentUserId: string;
  onChanged: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function TasksPage({ currentUserId, onChanged, onToast }: TasksPageProps) {
  const [tasks, setTasks] = useState<ActionItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [github, setGithub] = useState<{
    configured: boolean;
    owner: string | null;
    repo: string | null;
    missingVars: string[];
  }>({ configured: false, owner: null, repo: null, missingVars: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'MINE' | 'RISK' | 'GITHUB'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const res = await api.getTasks();
      setTasks(res.tasks);
      setReminders(res.reminders);
      setGithub(res.github);
      if (!selectedId && res.tasks.length > 0) {
        setSelectedId(res.tasks[0].id);
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleStatusChange = async (taskId: string, status: ActionStatus) => {
    setBusyTaskId(taskId);
    try {
      await api.updateTaskStatus(taskId, status, currentUserId);
      onToast('success', `Task status updated to ${status.toLowerCase().replace('_', ' ')}.`);
      await loadTasks();
      onChanged();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleCreateIssue = async (task: ActionItem) => {
    setBusyTaskId(task.id);
    try {
      const res = await api.createGitHubIssue({
        actionItemId: task.id,
        approvalId: task.approval_id ?? undefined,
        userId: currentUserId,
      });
      onToast('success', `Task created · GitHub Issue #${res.externalTask.external_id}`);
      await loadTasks();
      onChanged();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleSyncGitHub = async (taskId: string) => {
    setBusyTaskId(taskId);
    try {
      const res = await api.syncGitHubIssue(taskId);
      onToast('success', `Synced GitHub issue #${res.externalTask.external_id} (${res.externalTask.external_status}).`);
      await loadTasks();
      onChanged();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  };

  const reminderByTask = new Map<string, Reminder>();
  for (const r of reminders) {
    reminderByTask.set(r.action_item_id, r);
  }

  const filtered = tasks.filter((t) => {
    const matchesSearch =
      !search.trim() ||
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.owner_name ?? '').toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'MINE') return t.owner_id === currentUserId;
    if (filter === 'RISK') {
      const rem = reminderByTask.get(t.id);
      return t.status === 'OVERDUE' || t.is_open_loop === 1 || rem?.reminder_type === 'AT_RISK' || rem?.reminder_type === 'OVERDUE';
    }
    if (filter === 'GITHUB') return Boolean(t.external_task);
    return true;
  });

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const selectedReminder = selectedTask ? reminderByTask.get(selectedTask.id) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-raven-950 font-display">Tasks</h2>
          <p className="text-sm text-seagrass-600 mt-0.5">
            Track owners, deadlines, and GitHub issue execution linked back to meeting decisions.
          </p>
        </div>

        <div className="text-xs text-seagrass-600">
          {github.configured ? (
            <span className="font-mono">
              GitHub: {github.owner}/{github.repo}
            </span>
          ) : (
            <span className="text-apricot-700 bg-apricot-50 border border-apricot-200 rounded px-2.5 py-1.5">
              GitHub not configured
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-seagrass-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks or owners…"
            className="w-full rounded-md border border-seagrass-200 bg-white pl-9 pr-3 py-2 text-sm text-raven-950 focus:border-raven-700 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-seagrass-200/80 rounded-lg">
          {[
            { id: 'ALL' as const, label: 'All Tasks' },
            { id: 'MINE' as const, label: 'My Tasks' },
            { id: 'RISK' as const, label: 'At Risk & Overdue' },
            { id: 'GITHUB' as const, label: 'GitHub Linked' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filter === tab.id ? 'bg-raven-900 text-white' : 'text-seagrass-700 hover:text-raven-950'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Tasks List */}
        <div className="lg:col-span-7 rounded-lg border border-seagrass-200 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-seagrass-600">Loading tasks…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-sm text-seagrass-600 text-center">No tasks match this filter.</div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              {filtered.map((t) => {
                const rem = reminderByTask.get(t.id);
                const isSelected = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(t.id);
                      setEvidenceOpen(false);
                    }}
                    className={`w-full text-left px-5 py-4 transition-colors flex items-start justify-between gap-4 ${
                      isSelected
                        ? 'bg-raven-100/70 border-l-2 border-l-raven-900'
                        : 'hover:bg-seagrass-50/70'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-raven-950">{t.title}</div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-500">
                        <span className={t.owner_name ? 'font-medium text-seagrass-700' : 'text-apricot-700 font-medium'}>
                          {t.owner_name ?? 'Owner not confirmed'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {t.due_date ? `Due ${formatShortDate(t.due_date)}` : 'No deadline'}
                        </span>
                        {t.meeting_title && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{t.meeting_title}</span>
                          </>
                        )}
                        {t.external_task && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-raven-800">
                              GitHub #{t.external_task.external_id}
                            </span>
                          </>
                        )}
                      </div>
                      {rem && <div className="text-xs text-apricot-700">{rem.message}</div>}
                    </div>

                    <div className="shrink-0">
                      <StatusTag status={t.status} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Task Inspector */}
        <div className="lg:col-span-5 rounded-lg border border-seagrass-200 bg-white">
          {!selectedTask ? (
            <div className="p-8 text-sm text-seagrass-600 text-center">
              Select a task to view owner, deadline, GitHub status, and meeting evidence.
            </div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              <div className="p-5 space-y-2.5 bg-raven-50/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-seagrass-500">Task Detail</span>
                  <StatusTag status={selectedTask.status} />
                </div>
                <h3 className="text-base font-semibold text-raven-950 font-display">{selectedTask.title}</h3>
                {selectedTask.description && (
                  <p className="text-xs text-seagrass-600 leading-relaxed">{selectedTask.description}</p>
                )}
                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <div>
                    <div className="text-seagrass-500">Owner</div>
                    <div className={`font-medium mt-0.5 ${selectedTask.owner_name ? 'text-raven-950' : 'text-apricot-700'}`}>
                      {selectedTask.owner_name ?? 'Owner not confirmed'}
                    </div>
                  </div>
                  <div>
                    <div className="text-seagrass-500">Due date</div>
                    <div className="font-mono text-raven-950 tabular-nums mt-0.5">
                      {selectedTask.due_date ? formatShortDate(selectedTask.due_date) : 'No deadline'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Control */}
              <div className="p-5 space-y-2.5">
                <div className="text-xs font-medium text-seagrass-600">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['OPEN', 'IN_PROGRESS', 'COMPLETED'] as ActionStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={busyTaskId === selectedTask.id || selectedTask.status === st}
                      onClick={() => handleStatusChange(selectedTask.id, st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                        selectedTask.status === st
                          ? 'bg-raven-900 text-white border-raven-900'
                          : 'bg-white text-raven-900 border-seagrass-300 hover:bg-seagrass-50'
                      } disabled:opacity-60`}
                    >
                      {st === 'OPEN' ? 'Open' : st === 'IN_PROGRESS' ? 'In Progress' : 'Completed'}
                    </button>
                  ))}
                </div>
                {selectedTask.status === 'PROPOSED' && (
                  <p className="text-xs text-apricot-700">
                    Waiting for approval in Conflicts &amp; Approvals before status changes or GitHub execution.
                  </p>
                )}
              </div>

              {/* GitHub Execution */}
              <div className="p-5 space-y-3">
                <div className="text-xs font-medium text-seagrass-600">External Execution</div>
                {selectedTask.external_task ? (
                  <div className="rounded-md border border-seagrass-200 bg-seagrass-50 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-mono text-raven-950">
                      <span>Task</span>
                      <ArrowRight className="w-3.5 h-3.5 text-seagrass-400" />
                      <span>GitHub #{selectedTask.external_task.external_id}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-seagrass-400" />
                      <span className="font-semibold text-raven-800 capitalize">
                        {selectedTask.external_task.external_status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <a
                        href={selectedTask.external_task.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-raven-700 hover:text-raven-950"
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>Open in GitHub</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      <button
                        type="button"
                        onClick={() => handleSyncGitHub(selectedTask.id)}
                        disabled={busyTaskId === selectedTask.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-seagrass-600 hover:text-raven-950"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Sync Status</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => handleCreateIssue(selectedTask)}
                      disabled={busyTaskId === selectedTask.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60"
                    >
                      {busyTaskId === selectedTask.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Creating GitHub Issue…</span>
                        </>
                      ) : (
                        <span>Create GitHub Issue</span>
                      )}
                    </button>
                    <p className="text-xs text-seagrass-500">
                      Requires prior human approval before creating an issue in GitHub.
                    </p>
                  </div>
                )}
              </div>

              {/* Compact Evidence (Progressive Disclosure) */}
              <div className="p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-seagrass-600">Evidence</span>
                  {selectedTask.source_quote && (
                    <button
                      type="button"
                      onClick={() => setEvidenceOpen(!evidenceOpen)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-raven-700 hover:text-raven-950"
                    >
                      {evidenceOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>{evidenceOpen ? 'Hide Quote' : 'View Evidence'}</span>
                    </button>
                  )}
                </div>
                <div className="text-xs text-seagrass-700">
                  Meeting: {selectedTask.meeting_title ?? 'Meeting'}
                  {selectedTask.meeting_date ? ` · ${formatShortDate(selectedTask.meeting_date)}` : ''}
                  {selectedTask.source_speaker ? ` · Speaker: ${selectedTask.source_speaker}` : ''}
                </div>
                {evidenceOpen && selectedTask.source_quote && (
                  <div className="rounded bg-seagrass-50 border border-seagrass-200 p-3 text-xs text-raven-950 leading-relaxed">
                    &ldquo;{selectedTask.source_quote}&rdquo;
                  </div>
                )}
                {selectedReminder && (
                  <div className="rounded bg-apricot-50 border border-apricot-200 p-3 text-xs text-apricot-700">
                    {selectedReminder.message}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
