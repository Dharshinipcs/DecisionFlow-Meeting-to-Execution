import { useEffect, useState } from 'react';
import { ArrowDown, GitBranch, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { Conflict, Decision, DecisionVersion, Dependency } from '../types/decisionflow';
import { formatShortDate, formatShortMonthDay, StatusTag } from '../components/StatusBadge';

export function DecisionMemoryPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    decision: Decision;
    lineage: Decision[];
    versions: DecisionVersion[];
    dependencies: Dependency[];
    conflicts: Conflict[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.getDecisions();
        setDecisions(res.decisions);
        const firstActive = res.decisions.find((d) => d.status === 'ACTIVE') ?? res.decisions[0];
        if (firstActive) {
          setSelectedId(firstActive.id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    (async () => {
      try {
        const d = await api.getDecisionDetail(selectedId);
        setDetail(d);
      } catch {
        setDetail(null);
      }
    })();
  }, [selectedId]);

  const filtered = decisions.filter((d) => {
    const matchesSearch =
      !search.trim() ||
      d.topic.toLowerCase().includes(search.toLowerCase()) ||
      d.decision_text.toLowerCase().includes(search.toLowerCase()) ||
      (d.owner_name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-raven-950 font-display">Decision Memory</h2>
        <p className="text-sm text-seagrass-600 mt-0.5">
          Every decision across meetings, its current status, and complete version history. Superseded decisions are always preserved.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-seagrass-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search decisions, topics, or owners…"
            className="w-full rounded-md border border-seagrass-200 bg-white pl-9 pr-3 py-2 text-sm text-raven-950 focus:border-raven-700 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-seagrass-200/80 rounded-lg">
          {['ALL', 'ACTIVE', 'PROPOSED', 'SUPERSEDED', 'REJECTED'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === st ? 'bg-raven-900 text-white' : 'text-seagrass-700 hover:text-raven-950'
              }`}
            >
              {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Decision List */}
        <div className="lg:col-span-7 rounded-lg border border-seagrass-200 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-seagrass-600">Loading decision memory…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-sm text-seagrass-600 text-center">No matching decisions found.</div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              {filtered.map((d) => {
                const isSelected = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full text-left px-5 py-4 transition-colors flex items-start justify-between gap-4 ${
                      isSelected
                        ? 'bg-raven-100/70 border-l-2 border-l-raven-900'
                        : 'hover:bg-seagrass-50/70'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-500">
                        <span className="font-semibold text-raven-900">{d.topic}</span>
                        <span aria-hidden="true">·</span>
                        <span>{d.owner_name ?? 'Owner not confirmed'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{d.meeting_title ?? 'Meeting'}</span>
                        {d.effective_date && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatShortMonthDay(d.effective_date)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-sm font-medium text-raven-950 mt-1">{d.decision_text}</div>
                    </div>
                    <StatusTag status={d.status} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Version History & Provenance Inspector */}
        <div className="lg:col-span-5 rounded-lg border border-seagrass-200 bg-white">
          {!detail ? (
            <div className="p-8 text-sm text-seagrass-600 text-center">
              Select a decision to view its history, evidence, and dependencies.
            </div>
          ) : (
            <div className="divide-y divide-seagrass-100">
              <div className="p-5 space-y-2 bg-raven-50/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-seagrass-500">{detail.decision.topic}</span>
                  <StatusTag status={detail.decision.status} />
                </div>
                <h3 className="text-base font-semibold text-raven-950 font-display">
                  {detail.decision.decision_text}
                </h3>
                <div className="text-xs text-seagrass-600 font-mono tabular-nums">
                  Owner: {detail.decision.owner_name ?? 'Owner not confirmed'} · Date:{' '}
                  {detail.decision.effective_date ? formatShortDate(detail.decision.effective_date) : 'No date'}
                </div>
                {detail.decision.rationale && (
                  <p className="text-xs text-seagrass-700 pt-1 leading-relaxed">{detail.decision.rationale}</p>
                )}
              </div>

              {/* Decision History Timeline */}
              <div className="p-5 space-y-3">
                <div className="text-xs font-medium text-seagrass-600">Decision History</div>
                <div className="space-y-2">
                  {detail.lineage.map((node, idx) => (
                    <div key={node.id}>
                      <div
                        className={`rounded-md border p-3.5 ${
                          node.status === 'ACTIVE'
                            ? 'border-raven-200 bg-raven-50'
                            : 'border-seagrass-200 bg-seagrass-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono font-medium text-raven-950 tabular-nums">
                            {node.effective_date ? formatShortMonthDay(node.effective_date) : 'No date'} · {node.meeting_title}
                          </span>
                          <StatusTag status={node.status} />
                        </div>
                        <div className="text-xs text-raven-950 mt-1.5 font-medium">{node.decision_text}</div>
                        {node.source_quote && (
                          <div className="text-xs text-seagrass-600 mt-1.5">
                            Evidence ({node.source_speaker}): &ldquo;{node.source_quote}&rdquo;
                          </div>
                        )}
                      </div>
                      {idx < detail.lineage.length - 1 && (
                        <div className="flex justify-center py-1">
                          <ArrowDown className="w-3.5 h-3.5 text-seagrass-400" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Linked Dependencies */}
              <div className="p-5 space-y-2">
                <div className="text-xs font-medium text-seagrass-600">Linked Dependencies</div>
                {detail.dependencies.length === 0 ? (
                  <p className="text-xs text-seagrass-500">No linked dependencies.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.dependencies.map((dep) => (
                      <div key={dep.id} className="flex items-start gap-2 text-xs text-seagrass-700">
                        <GitBranch className="w-3.5 h-3.5 text-raven-700 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-medium text-raven-950">{dep.source_title}</span>
                          {dep.source_date && (
                            <span className="font-mono text-seagrass-500"> ({formatShortMonthDay(dep.source_date)})</span>
                          )}{' '}
                          <span className="text-seagrass-600">{dep.relationship.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                          <span className="font-medium text-raven-950">{dep.target_title}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Conflict History */}
              {detail.conflicts.length > 0 && (
                <div className="p-5 space-y-2">
                  <div className="text-xs font-medium text-seagrass-600">Conflict History</div>
                  {detail.conflicts.map((c) => (
                    <div key={c.id} className="text-xs text-seagrass-700 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <StatusTag status={c.severity} />
                        <StatusTag status={c.status} />
                      </div>
                      <p className="leading-relaxed">{c.explanation}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
