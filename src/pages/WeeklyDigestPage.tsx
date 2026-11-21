import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { User, WeeklyDigest } from '../types/decisionflow';
import { formatShortDate, formatShortMonthDay, StatusTag } from '../components/StatusBadge';

interface WeeklyDigestPageProps {
  users: User[];
  currentUserId: string;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function WeeklyDigestPage({ users, currentUserId, onToast }: WeeklyDigestPageProps) {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId);
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDigest = async (userId: string, refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getDigest(userId, refresh);
      setDigest(res.digest);
      if (refresh) {
        onToast('success', 'Generated fresh weekly summary from current workspace records.');
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setSelectedUserId(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    if (selectedUserId) {
      loadDigest(selectedUserId, false);
    }
  }, [selectedUserId]);

  const targetUser = users.find((u) => u.id === selectedUserId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-raven-950 font-display">
            {targetUser ? `${targetUser.name.split(' ')[0]}'s Weekly Digest` : 'Weekly Digest'}
          </h2>
          <p className="text-sm text-seagrass-600 mt-0.5">
            Concise weekly summary of decisions, open work, upcoming deadlines, and active risks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            aria-label="Select team member for weekly digest"
            className="rounded-md border border-seagrass-300 bg-white px-3 py-2 text-xs font-medium text-raven-950 focus:border-raven-700 focus:outline-none"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => loadDigest(selectedUserId, true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {refreshing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Refresh Digest</span>
          </button>
        </div>
      </div>

      {loading && !digest ? (
        <div className="p-8 text-sm text-seagrass-600">Generating weekly summary…</div>
      ) : !digest ? (
        <div className="rounded-lg border border-seagrass-200 bg-white p-8 text-sm text-seagrass-600">
          Unable to load digest.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Executive Summary */}
          <div className="rounded-lg border border-raven-800 bg-raven-900 text-white p-6 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-raven-200 font-mono tabular-nums">
              <span>
                Week of {formatShortDate(digest.week_start)} – {formatShortDate(digest.week_end)}
              </span>
              <span>Updated {digest.generated_at.slice(0, 16).replace('T', ' ')}</span>
            </div>
            <p className="text-sm text-raven-50 leading-relaxed">{digest.content.summary}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Important Decisions */}
            <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75">
                <h3 className="text-sm font-semibold text-raven-950 font-display">Important Decisions</h3>
              </div>
              {digest.content.decisionsAffectingYou.length === 0 ? (
                <div className="p-5 text-xs text-seagrass-600">No active or recent decision updates.</div>
              ) : (
                <div className="divide-y divide-seagrass-100">
                  {digest.content.decisionsAffectingYou.map((d) => (
                    <div key={d.decisionId} className="px-5 py-3.5 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-seagrass-500">{d.topic}</div>
                        <div className="text-sm font-medium text-raven-950 mt-0.5">{d.summary}</div>
                      </div>
                      <StatusTag status={d.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Open Work & Upcoming Deadlines */}
            <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-raven-950 font-display">Open Work &amp; Deadlines</h3>
                <span className="text-xs font-mono text-seagrass-500 tabular-nums">
                  {digest.content.needsAttention.length}
                </span>
              </div>
              {digest.content.needsAttention.length === 0 ? (
                <div className="p-5 text-xs text-seagrass-600">No open tasks assigned right now.</div>
              ) : (
                <div className="divide-y divide-seagrass-100">
                  {digest.content.needsAttention.map((item, idx) => (
                    <div key={idx} className="px-5 py-3.5 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-raven-950">{item.title}</div>
                        <div className="text-xs text-seagrass-600 mt-0.5">
                          {item.dueDate ? `Due ${formatShortMonthDay(item.dueDate)}` : 'No deadline'} · {item.reason}
                        </div>
                      </div>
                      <StatusTag status={item.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Risks & Unresolved Conflicts */}
            <section className="rounded-lg border border-seagrass-200 border-l-4 border-l-apricot-500 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-seagrass-200 bg-apricot-50/70 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-raven-950 font-display">Risks &amp; Open Loops</h3>
                <span className="text-xs font-mono text-apricot-700 tabular-nums">
                  {digest.content.atRisk.length +
                    digest.content.unresolvedConflicts.length +
                    digest.content.openLoops.length}
                </span>
              </div>
              {digest.content.atRisk.length === 0 &&
              digest.content.openLoops.length === 0 &&
              digest.content.unresolvedConflicts.length === 0 ? (
                <div className="p-5 text-xs text-seagrass-600">No active risks, open loops, or conflicts.</div>
              ) : (
                <div className="divide-y divide-seagrass-100">
                  {digest.content.unresolvedConflicts.map((c) => (
                    <div key={c.conflictId} className="px-5 py-3.5 space-y-1.5">
                      <StatusTag status={c.severity} />
                      <p className="text-xs text-raven-950">{c.explanation}</p>
                    </div>
                  ))}
                  {digest.content.atRisk.map((item, idx) => (
                    <div key={idx} className="px-5 py-3.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-raven-950">{item.title}</span>
                        <StatusTag status="AT_RISK" />
                      </div>
                      <p className="text-xs text-seagrass-600">{item.reason}</p>
                    </div>
                  ))}
                  {digest.content.openLoops.map((loop, idx) => (
                    <div key={idx} className="px-5 py-3.5">
                      <div className="text-sm font-medium text-raven-950">{loop.title}</div>
                      <div className="text-xs text-apricot-700 mt-0.5">
                        {loop.reason} · {loop.meetingTitle}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Completed Work */}
            <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-raven-950 font-display">Completed Work</h3>
                <span className="text-xs font-mono text-seagrass-500 tabular-nums">
                  {digest.content.completed.length}
                </span>
              </div>
              {digest.content.completed.length === 0 ? (
                <div className="p-5 text-xs text-seagrass-600">No tasks marked completed yet this week.</div>
              ) : (
                <div className="divide-y divide-seagrass-100">
                  {digest.content.completed.map((c, idx) => (
                    <div key={idx} className="px-5 py-3 flex items-center justify-between text-sm">
                      <span className="text-raven-950">{c.title}</span>
                      <span className="text-xs font-mono text-seagrass-500 tabular-nums">{c.completedAt}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
