import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { DashboardPayload } from '../types/decisionflow';
import { formatShortDate, formatShortMonthDay, StatusTag } from '../components/StatusBadge';
import type { NavRoute } from '../components/Layout';

interface DashboardPageProps {
  data: DashboardPayload | null;
  processedMeetingsCount: number;
  loading: boolean;
  error: string | null;
  onNavigate: (route: NavRoute, meetingId?: string) => void;
  onOpenUpload: () => void;
}

export function getTimeBasedGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage({
  data,
  processedMeetingsCount,
  loading,
  error,
  onNavigate,
  onOpenUpload,
}: DashboardPageProps) {
  const [showActivity, setShowActivity] = useState(false);
  const [greeting, setGreeting] = useState(() => getTimeBasedGreeting());

  useEffect(() => {
    const updateGreeting = () => setGreeting(getTimeBasedGreeting());
    updateGreeting();
    const timer = setInterval(updateGreeting, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-14 rounded-lg border border-seagrass-200 bg-seagrass-50 animate-pulse" />
        <div className="h-20 rounded-lg border border-raven-800 bg-raven-900 animate-pulse" />
        <div className="h-56 rounded-lg border border-seagrass-200 bg-white animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-apricot-200 bg-apricot-50 p-6 text-sm text-apricot-700">
        {error || 'Unable to load workspace overview.'}
      </div>
    );
  }

  const firstName = data.currentUser.name.split(' ')[0];
  const hasUrgentWork = data.metrics.pendingApprovals > 0 || data.metrics.openConflicts > 0;
  const attentionTotal = data.metrics.openConflicts + data.metrics.atRiskCount;

  return (
    <div className="space-y-7">
      {/* Situational Header & Single Dominant Primary Action */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-raven-950 font-display text-balance">
            {greeting}, {firstName}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {hasUrgentWork ? (
            <>
              <button
                type="button"
                onClick={onOpenUpload}
                className="px-3.5 py-2 text-xs font-medium text-raven-900 bg-seagrass-50 border border-seagrass-300 rounded-md hover:bg-white transition-colors whitespace-nowrap shrink-0"
              >
                Upload Transcript
              </button>
              <button
                type="button"
                onClick={() => onNavigate('conflicts')}
                className="inline-flex items-center gap-2 rounded-md bg-raven-900 px-4 py-2 text-xs font-medium text-white hover:bg-raven-800 transition-colors whitespace-nowrap shrink-0"
              >
                <span>
                  Review {data.metrics.pendingApprovals} Pending Approval{data.metrics.pendingApprovals === 1 ? '' : 's'}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-apricot-300" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-2 rounded-md bg-raven-900 px-4 py-2 text-xs font-medium text-white hover:bg-raven-800 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Process New Meeting</span>
              <ArrowRight className="w-3.5 h-3.5 text-apricot-300" />
            </button>
          )}
        </div>
      </div>

      {/* Separated Workspace Snapshot Cards (Toned-Down Raven Teal) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('meetings')}
          className="text-left rounded-lg border border-raven-200 bg-raven-100/65 px-5 py-4 hover:bg-raven-100 transition-colors"
        >
          <div className="text-xs text-raven-700">Meetings processed</div>
          <div className="mt-1.5 text-2xl font-semibold text-raven-950 font-mono tabular-nums">
            {processedMeetingsCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('decisions')}
          className="text-left rounded-lg border border-raven-200 bg-raven-100/65 px-5 py-4 hover:bg-raven-100 transition-colors"
        >
          <div className="text-xs text-raven-700">Active decisions</div>
          <div className="mt-1.5 text-2xl font-semibold text-raven-950 font-mono tabular-nums">
            {data.metrics.activeDecisions}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('tasks')}
          className="text-left rounded-lg border border-raven-200 bg-raven-100/65 px-5 py-4 hover:bg-raven-100 transition-colors"
        >
          <div className="text-xs text-raven-700">Open tasks</div>
          <div className="mt-1.5 text-2xl font-semibold text-raven-950 font-mono tabular-nums">
            {data.metrics.myTasks}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('conflicts')}
          className="text-left rounded-lg border border-raven-200 bg-raven-100/65 px-5 py-4 hover:bg-raven-100 transition-colors"
        >
          <div className="text-xs text-raven-700">Awaiting approval</div>
          <div
            className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${
              data.metrics.pendingApprovals > 0 ? 'text-apricot-700' : 'text-raven-950'
            }`}
          >
            {data.metrics.pendingApprovals}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('conflicts')}
          className="text-left rounded-lg border border-raven-200 bg-raven-100/65 px-5 py-4 hover:bg-raven-100 transition-colors col-span-2 sm:col-span-1"
        >
          <div className="text-xs text-raven-700">Active risks &amp; conflicts</div>
          <div
            className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${
              attentionTotal > 0 ? 'text-apricot-700' : 'text-raven-950'
            }`}
          >
            {attentionTotal}
          </div>
        </button>
      </div>

      {/* Hero Section: Needs Your Attention (Apricot Flare Accent when active) */}
      <section
        className={`rounded-lg border bg-white overflow-hidden ${
          hasUrgentWork || data.needsAttention.length > 0
            ? 'border-seagrass-200 border-l-4 border-l-apricot-500'
            : 'border-seagrass-200'
        }`}
      >
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-seagrass-200 ${
            hasUrgentWork || data.needsAttention.length > 0 ? 'bg-apricot-50/75' : 'bg-raven-50'
          }`}
        >
          <div>
            <h3 className="text-base font-semibold text-raven-950 font-display">Needs Your Attention</h3>
          </div>
          {data.metrics.pendingApprovals > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('conflicts')}
              className="text-xs font-semibold text-apricot-700 hover:text-raven-950 underline underline-offset-2 whitespace-nowrap"
            >
              Open Conflicts &amp; Approvals
            </button>
          )}
        </div>

        {data.needsAttention.length === 0 && data.metrics.pendingApprovals === 0 ? (
          <div className="px-6 py-8 text-center space-y-2">
            <div className="text-sm font-medium text-raven-950">All caught up</div>
            <p className="text-xs text-seagrass-600">
              No pending approvals, open conflicts, or urgent deadline risks right now.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-seagrass-100">
            {data.metrics.pendingApprovals > 0 && data.needsAttention.every((i) => i.kind !== 'CONFLICT') && (
              <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-raven-950">
                    {data.metrics.pendingApprovals} item{data.metrics.pendingApprovals === 1 ? '' : 's'} waiting for human approval
                  </div>
                  <p className="text-xs text-seagrass-600 mt-0.5">
                    Proposed decisions and action items require review before becoming active or creating GitHub issues.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('conflicts')}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-apricot-600 rounded-md hover:bg-apricot-700 whitespace-nowrap shrink-0 transition-colors"
                >
                  Review Approvals
                </button>
              </div>
            )}

            {data.needsAttention.map((item) => (
              <div
                key={item.id}
                className="px-6 py-4 flex flex-wrap items-center justify-between gap-4 hover:bg-seagrass-50/70 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-600">
                    <span className="font-medium text-raven-900">
                      {item.kind === 'CONFLICT' ? 'Conflict Detected' : 'Upcoming / At-Risk Deadline'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <StatusTag status={item.severity} />
                  </div>
                  <div className="text-sm font-medium text-raven-950">{item.title}</div>
                  <p className="text-xs text-seagrass-600 line-clamp-2">{item.subtitle}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate(item.href === '/conflicts' ? 'conflicts' : 'tasks')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    item.kind === 'CONFLICT'
                      ? 'bg-apricot-600 text-white hover:bg-apricot-700'
                      : 'text-raven-900 bg-seagrass-50 border border-seagrass-300 hover:bg-white'
                  }`}
                >
                  {item.kind === 'CONFLICT' ? 'Review Conflict' : 'Inspect Task'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Two-Column Overview: Recent Decisions & Recent Meetings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-seagrass-200 bg-raven-50/70">
            <h3 className="text-sm font-semibold text-raven-950 font-display">Recent Decisions</h3>
            <button
              type="button"
              onClick={() => onNavigate('decisions')}
              className="text-xs font-medium text-raven-800 hover:text-raven-950 whitespace-nowrap"
            >
              View Decision Memory
            </button>
          </div>

          {data.recentDecisions.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-seagrass-600">No decisions recorded yet.</div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              {data.recentDecisions.slice(0, 4).map((dec) => (
                <div key={dec.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-500">
                      <span className="font-medium text-seagrass-700">{dec.topic}</span>
                      <span aria-hidden="true">·</span>
                      <span>{dec.owner_name ?? 'Owner not confirmed'}</span>
                      {dec.effective_date && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatShortMonthDay(dec.effective_date)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-sm font-medium text-raven-950 mt-1">{dec.decision_text}</div>
                  </div>
                  <StatusTag status={dec.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-seagrass-200 bg-raven-50/70">
            <h3 className="text-sm font-semibold text-raven-950 font-display">Recent Meetings</h3>
            <button
              type="button"
              onClick={() => onNavigate('meetings')}
              className="text-xs font-medium text-raven-800 hover:text-raven-950 whitespace-nowrap"
            >
              View All Meetings
            </button>
          </div>
          <div className="divide-y divide-seagrass-100">
            {data.recentMeetings.slice(0, 4).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onNavigate('meeting-detail', m.id)}
                className="w-full text-left px-5 py-3.5 hover:bg-seagrass-50/70 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-raven-950 truncate">{m.title}</div>
                  <div className="mt-0.5 text-xs text-seagrass-500 font-mono tabular-nums">
                    {formatShortDate(m.meeting_date)} · {m.decision_count ?? 0} decisions · {m.action_count ?? 0} actions
                  </div>
                </div>
                <StatusTag status={m.processing_status} />
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Progressive Disclosure: Recent Activity */}
      {data.recentAudit.length > 0 && (
        <section className="rounded-lg border border-seagrass-200 bg-white">
          <button
            type="button"
            onClick={() => setShowActivity(!showActivity)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-seagrass-50/60 transition-colors"
          >
            <span className="text-xs font-medium text-seagrass-700">
              Recent Agent Activity ({data.recentAudit.length})
            </span>
            {showActivity ? (
              <ChevronUp className="w-4 h-4 text-seagrass-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-seagrass-500" />
            )}
          </button>
          {showActivity && (
            <div className="border-t border-seagrass-200 divide-y divide-seagrass-100">
              {data.recentAudit.slice(0, 6).map((ev) => (
                <div key={ev.id} className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-raven-950">{ev.description}</p>
                  <span className="text-xs text-seagrass-500 font-mono tabular-nums shrink-0">
                    {ev.created_at.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
