import { useState } from 'react';
import { CalendarDays, Loader2, Play, Search } from 'lucide-react';
import type { Meeting } from '../types/decisionflow';
import { formatShortDate, StatusTag } from '../components/StatusBadge';

interface MeetingsPageProps {
  meetings: Meeting[];
  loading: boolean;
  onSelectMeeting: (meetingId: string) => void;
  onProcessMeeting: (meetingId: string) => Promise<void>;
  onOpenUpload: () => void;
}

export function MeetingsPage({
  meetings,
  loading,
  onSelectMeeting,
  onProcessMeeting,
  onOpenUpload,
}: MeetingsPageProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const filtered = meetings.filter((m) => {
    const matchesSearch =
      !search.trim() ||
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.source_file_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (m.summary ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || m.processing_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleProcess = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setProcessingId(id);
    try {
      await onProcessMeeting(id);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-raven-950 font-display">Meetings</h2>
          <p className="text-sm text-seagrass-600 mt-0.5">
            Upload or paste transcripts to recognize speakers, extract decisions and actions, and check conflicts.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenUpload}
          className="px-4 py-2 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800 whitespace-nowrap shrink-0 transition-colors"
        >
          Upload Transcript
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-seagrass-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search meetings…"
            className="w-full rounded-md border border-seagrass-200 bg-white pl-9 pr-3 py-2 text-sm text-raven-950 focus:border-raven-700 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-seagrass-200/80 rounded-lg">
          {['ALL', 'PROCESSED', 'UPLOADED', 'FAILED'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-raven-900 text-white'
                  : 'text-seagrass-700 hover:text-raven-950'
              }`}
            >
              {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Meetings List */}
      <div className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-seagrass-600">Loading meetings…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <CalendarDays className="w-8 h-8 text-seagrass-300 mx-auto" />
            <div className="text-sm font-medium text-raven-950">No meetings found</div>
            <p className="text-xs text-seagrass-600">Upload a .txt, .md, or pasted meeting transcript to begin.</p>
            <button
              type="button"
              onClick={onOpenUpload}
              className="px-4 py-2 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800"
            >
              Upload Transcript
            </button>
          </div>
        ) : (
          <div className="divide-y divide-seagrass-100">
            {filtered.map((m) => (
              <div
                key={m.id}
                onClick={() => onSelectMeeting(m.id)}
                className="px-5 py-4 flex flex-wrap items-center justify-between gap-4 hover:bg-seagrass-50/70 cursor-pointer transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-500 font-mono tabular-nums">
                    <span>{formatShortDate(m.meeting_date)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{m.source_type}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {m.decision_count ?? 0} decision{m.decision_count === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {m.action_count ?? 0} action{m.action_count === 1 ? '' : 's'}
                    </span>
                    {(m.conflict_count ?? 0) > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-apricot-700 font-semibold">
                          {m.conflict_count} conflict{m.conflict_count === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-raven-950">{m.title}</div>
                  {m.summary && (
                    <p className="text-xs text-seagrass-600 line-clamp-1 max-w-2xl">{m.summary}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <StatusTag status={m.processing_status} />
                  {m.processing_status === 'UPLOADED' || m.processing_status === 'FAILED' ? (
                    <button
                      type="button"
                      onClick={(e) => handleProcess(e, m.id)}
                      disabled={processingId === m.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60 whitespace-nowrap"
                    >
                      {processingId === m.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Processing…</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Process Meeting</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-raven-700 whitespace-nowrap">
                      Open Meeting
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
