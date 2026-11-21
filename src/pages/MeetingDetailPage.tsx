import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Loader2,
  Play,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  ActionItem,
  AuditEvent,
  Conflict,
  Decision,
  Dependency,
  Meeting,
  MeetingParticipant,
  TranscriptSegment,
} from '../types/decisionflow';
import { formatShortDate, StatusTag } from '../components/StatusBadge';
import type { NavRoute } from '../components/Layout';

interface MeetingDetailPageProps {
  meetingId: string;
  onBack: () => void;
  onNavigate: (route: NavRoute) => void;
  onProcessed: () => void;
}

export function MeetingDetailPage({
  meetingId,
  onBack,
  onNavigate,
  onProcessed,
}: MeetingDetailPageProps) {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  const [detail, setDetail] = useState<{
    meeting: Meeting & { raw_transcript: string };
    participants: MeetingParticipant[];
    segments: TranscriptSegment[];
    decisions: Decision[];
    actions: ActionItem[];
    dependencies: Dependency[];
    conflicts: Conflict[];
    audit: AuditEvent[];
  } | null>(null);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMeetingDetail(meetingId);
      setDetail(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [meetingId]);

  const handleProcess = async () => {
    setProcessing(true);
    setError(null);
    try {
      await api.processMeeting(meetingId);
      await loadDetail();
      onProcessed();
    } catch (err) {
      setError((err as Error).message);
      await loadDetail();
    } finally {
      setProcessing(false);
    }
  };

  const jumpToSegment = (segmentId: string | null) => {
    if (!segmentId) return;
    setHighlightedSegmentId(segmentId);
    setTranscriptOpen(true);
    setTimeout(() => {
      const el = document.getElementById(`segment-${segmentId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  if (loading) {
    return <div className="p-8 text-sm text-seagrass-600">Loading meeting record…</div>;
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-apricot-200 bg-apricot-50 p-6 text-sm text-apricot-700">
        {error}
      </div>
    );
  }

  if (!detail) return null;

  const { meeting, participants, segments, decisions, actions, dependencies, conflicts, audit } = detail;

  return (
    <div className="space-y-6">
      {/* 1. Meeting Title -> Date & Status */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-seagrass-600 hover:text-raven-950"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Meetings</span>
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold text-raven-950 font-display">{meeting.title}</h2>
            <StatusTag status={meeting.processing_status} />
          </div>

          <div className="text-xs text-seagrass-600 font-mono tabular-nums">
            {formatShortDate(meeting.meeting_date)} · {meeting.source_type}
            {meeting.source_file_name ? ` · ${meeting.source_file_name}` : ''}
            {participants.length > 0 && (
              <span className="font-sans">
                {' '}· Participants:{' '}
                <span className="text-raven-950 font-medium">
                  {participants.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(', ')}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {(meeting.processing_status === 'UPLOADED' || meeting.processing_status === 'FAILED') && (
            <button
              type="button"
              onClick={handleProcess}
              disabled={processing}
              className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-4 py-2 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60 whitespace-nowrap"
            >
              {processing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing Meeting…</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Process Meeting</span>
                </>
              )}
            </button>
          )}
          {conflicts.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('conflicts')}
              className="inline-flex items-center gap-1.5 rounded-md bg-apricot-600 px-4 py-2 text-xs font-medium text-white hover:bg-apricot-700 whitespace-nowrap transition-colors"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Review Conflict ({conflicts.length})</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-apricot-200 bg-apricot-50 px-4 py-3 text-xs text-apricot-700">
          {error}
        </div>
      )}

      {meeting.processing_error && (
        <div className="rounded-md border border-apricot-200 bg-apricot-50 px-4 py-3 text-xs text-apricot-700">
          Processing Error: {meeting.processing_error}
        </div>
      )}

      {/* 2. Short Summary */}
      {meeting.summary && (
        <section className="rounded-lg border border-raven-800 bg-raven-900 text-white p-5">
          <div className="text-xs font-medium text-raven-200 mb-1.5">Summary</div>
          <p className="text-sm text-raven-50 leading-relaxed">{meeting.summary}</p>
        </section>
      )}

      {/* 3. Decisions & Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-raven-950 font-display">
              Decisions ({decisions.length})
            </h3>
          </div>
          {decisions.length === 0 ? (
            <div className="p-6 text-xs text-seagrass-600">No decisions extracted from this meeting.</div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              {decisions.map((d) => {
                const segSeq = segments.find((s) => s.id === d.source_segment_id)?.sequence_number;
                const evOpen = Boolean(expandedEvidence[d.id]);
                return (
                  <div key={d.id} className="p-5 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-seagrass-500">
                          {d.topic} · {d.owner_name ?? 'Owner not confirmed'}
                          {d.effective_date ? ` · ${formatShortDate(d.effective_date)}` : ''}
                        </div>
                        <div className="text-sm font-medium text-raven-950 mt-1">{d.decision_text}</div>
                      </div>
                      <StatusTag status={d.status} />
                    </div>
                    {d.rationale && <p className="text-xs text-seagrass-600">{d.rationale}</p>}
                    {d.source_quote && (
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEvidence((prev) => ({ ...prev, [d.id]: !prev[d.id] }))
                          }
                          className="text-xs font-medium text-raven-700 hover:text-raven-950 underline underline-offset-2"
                        >
                          {evOpen ? 'Hide Evidence' : 'View Evidence'}
                        </button>
                        {evOpen && (
                          <div className="mt-2 rounded-md bg-seagrass-50 border border-seagrass-200 px-3.5 py-2.5 text-xs text-seagrass-700 space-y-1.5">
                            <div>
                              <span className="font-semibold text-raven-950">{d.source_speaker}</span>
                              {segSeq ? ` · Transcript #${segSeq}` : ''}
                            </div>
                            <p>&ldquo;{d.source_quote}&rdquo;</p>
                            {d.source_segment_id && (
                              <button
                                type="button"
                                onClick={() => jumpToSegment(d.source_segment_id)}
                                className="text-xs font-medium text-raven-800 hover:text-raven-950 underline underline-offset-2"
                              >
                                Jump to transcript
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75">
            <h3 className="text-sm font-semibold text-raven-950 font-display">
              Action Items ({actions.length})
            </h3>
          </div>
          {actions.length === 0 ? (
            <div className="p-6 text-xs text-seagrass-600">No action items extracted from this meeting.</div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              {actions.map((a) => {
                const segSeq = segments.find((s) => s.id === a.source_segment_id)?.sequence_number;
                const evOpen = Boolean(expandedEvidence[a.id]);
                return (
                  <div key={a.id} className="p-5 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-seagrass-500">
                          <span className={a.owner_name ? 'font-medium text-raven-900' : 'text-apricot-700 font-medium'}>
                            {a.owner_name ?? 'Owner not confirmed'}
                          </span>
                          {' · '}
                          <span className="font-mono tabular-nums">
                            {a.due_date ? `Due ${formatShortDate(a.due_date)}` : 'No deadline'}
                          </span>
                          {' · '}
                          <span>{a.priority}</span>
                        </div>
                        <div className="text-sm font-medium text-raven-950 mt-1">{a.title}</div>
                      </div>
                      <StatusTag status={a.status} />
                    </div>
                    {a.is_open_loop === 1 && a.open_loop_reason && (
                      <div className="text-xs text-apricot-700 bg-apricot-50 border border-apricot-200 rounded px-2.5 py-1.5">
                        Open loop: {a.open_loop_reason}
                      </div>
                    )}
                    {a.source_quote && (
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEvidence((prev) => ({ ...prev, [a.id]: !prev[a.id] }))
                          }
                          className="text-xs font-medium text-raven-700 hover:text-raven-950 underline underline-offset-2"
                        >
                          {evOpen ? 'Hide Evidence' : 'View Evidence'}
                        </button>
                        {evOpen && (
                          <div className="mt-2 rounded-md bg-seagrass-50 border border-seagrass-200 px-3.5 py-2.5 text-xs text-seagrass-700 space-y-1.5">
                            <div>
                              <span className="font-semibold text-raven-950">{a.source_speaker}</span>
                              {segSeq ? ` · Transcript #${segSeq}` : ''}
                            </div>
                            <p>&ldquo;{a.source_quote}&rdquo;</p>
                            {a.source_segment_id && (
                              <button
                                type="button"
                                onClick={() => jumpToSegment(a.source_segment_id)}
                                className="text-xs font-medium text-raven-800 hover:text-raven-950 underline underline-offset-2"
                              >
                                Jump to transcript
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 4. Dependencies & Conflicts (Shown cleanly when present) */}
      {(dependencies.length > 0 || conflicts.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {conflicts.length > 0 && (
            <section className="rounded-lg border border-seagrass-200 border-l-4 border-l-apricot-500 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-apricot-200 bg-apricot-50/70 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-raven-950 font-display">
                  Conflicts Detected ({conflicts.length})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('conflicts')}
                  className="text-xs font-semibold text-apricot-700 hover:text-raven-950 underline underline-offset-2"
                >
                  Review Conflict
                </button>
              </div>
              <div className="divide-y divide-seagrass-100">
                {conflicts.map((c) => (
                  <div key={c.id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-raven-950">
                        {c.conflict_type.replace(/_/g, ' ')}
                      </span>
                      <StatusTag status={c.severity} />
                    </div>
                    <p className="text-sm text-seagrass-700 leading-relaxed">{c.explanation}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {dependencies.length > 0 && (
            <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75">
                <h3 className="text-sm font-semibold text-raven-950 font-display">
                  Dependencies ({dependencies.length})
                </h3>
              </div>
              <div className="divide-y divide-seagrass-100">
                {dependencies.map((dep) => (
                  <div key={dep.id} className="p-5 flex items-start gap-3 text-sm">
                    <GitBranch className="w-4 h-4 text-raven-700 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-raven-950">{dep.source_title}</span>{' '}
                      <span className="text-xs font-mono text-seagrass-600">
                        {dep.relationship.toLowerCase().replace(/_/g, ' ')}
                      </span>{' '}
                      <span className="font-medium text-raven-950">{dep.target_title}</span>
                      {dep.description && (
                        <p className="text-xs text-seagrass-600 mt-1">{dep.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 5. Transcript (Collapsible, clean speaker typography without heavy boxes) */}
      <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setTranscriptOpen(!transcriptOpen)}
          className="w-full px-5 py-4 bg-raven-50/60 flex items-center justify-between text-left hover:bg-raven-50 transition-colors"
        >
          <div>
            <h3 className="text-sm font-semibold text-raven-950 font-display">
              Transcript ({segments.length > 0 ? `${segments.length} statements` : 'Raw transcript'})
            </h3>
            <p className="text-xs text-seagrass-500 mt-0.5">
              Speaker-attributed dialogue preserved as verifiable evidence
            </p>
          </div>
          {transcriptOpen ? (
            <ChevronUp className="w-4 h-4 text-seagrass-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-seagrass-500 shrink-0" />
          )}
        </button>

        {transcriptOpen && (
          <div className="border-t border-seagrass-200">
            {segments.length === 0 ? (
              <div className="p-5 text-sm text-seagrass-700 whitespace-pre-wrap font-mono leading-relaxed">
                {meeting.raw_transcript}
              </div>
            ) : (
              <div className="divide-y divide-seagrass-100">
                {segments.map((seg) => {
                  const isHighlighted = highlightedSegmentId === seg.id;
                  return (
                    <div
                      key={seg.id}
                      id={`segment-${seg.id}`}
                      className={`px-5 py-3.5 flex items-baseline gap-4 transition-colors ${
                        isHighlighted ? 'bg-apricot-50' : ''
                      }`}
                    >
                      <span className="w-7 text-xs font-mono text-seagrass-400 tabular-nums shrink-0">
                        #{seg.sequence_number}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-semibold text-raven-950">{seg.speaker_name}</span>
                          {seg.speaker_role && (
                            <span className="text-xs text-seagrass-500">{seg.speaker_role}</span>
                          )}
                          {seg.start_time && (
                            <span className="text-xs font-mono text-seagrass-400 tabular-nums">
                              {seg.start_time}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-seagrass-800 leading-relaxed">{seg.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Progressive Disclosure: Agent Activity */}
      {audit.length > 0 && (
        <section className="rounded-lg border border-seagrass-200 bg-white">
          <button
            type="button"
            onClick={() => setActivityOpen(!activityOpen)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-seagrass-50/60 transition-colors"
          >
            <span className="text-xs font-medium text-seagrass-700">
              Processing &amp; Audit History ({audit.length})
            </span>
            {activityOpen ? (
              <ChevronUp className="w-4 h-4 text-seagrass-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-seagrass-500" />
            )}
          </button>
          {activityOpen && (
            <div className="border-t border-seagrass-200 divide-y divide-seagrass-100">
              {audit.map((ev) => (
                <div key={ev.id} className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-xs text-raven-950">{ev.description}</div>
                  <div className="text-xs font-mono text-seagrass-500 tabular-nums">{ev.created_at}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
