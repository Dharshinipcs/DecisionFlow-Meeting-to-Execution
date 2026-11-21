import { useState } from 'react';
import { ArrowRight, CalendarDays, GitBranch, Loader2, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { MemoryAnswer } from '../types/decisionflow';
import { formatShortDate, StatusTag } from '../components/StatusBadge';

interface AskMemoryPageProps {
  onOpenMeeting: (meetingId: string) => void;
}

const SUGGESTED_QUESTIONS = [
  'What is the current payment launch date?',
  'What dependencies affect the payment launch?',
  'What did Rahul commit to across meetings?',
  'What is our pricing model for enterprise customers?',
];

export function AskMemoryPage({ onOpenMeeting }: AskMemoryPageProps) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MemoryAnswer | null>(null);

  const runQuery = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    try {
      const answer = await api.askMemory(trimmed);
      setResult(answer);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-raven-950 font-display">Ask Memory</h2>
        <p className="text-sm text-seagrass-600 mt-0.5">
          Ask questions across all meetings, decisions, action items, and dependencies with verifiable evidence.
        </p>
      </div>

      {/* Query Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runQuery(question);
        }}
        className="flex flex-col sm:flex-row gap-3"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-seagrass-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask DecisionFlow about your team's decisions…"
            className="w-full rounded-md border border-seagrass-300 bg-white pl-10 pr-4 py-2.5 text-sm text-raven-950 focus:border-raven-700 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-raven-900 px-5 py-2.5 text-xs font-medium text-white hover:bg-raven-800 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Searching Memory…</span>
            </>
          ) : (
            <>
              <span>Ask Memory</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </form>

      {/* Suggested Questions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-seagrass-500">Examples:</span>
        {SUGGESTED_QUESTIONS.map((sq) => (
          <button
            key={sq}
            type="button"
            onClick={() => runQuery(sq)}
            className="rounded-md border border-seagrass-200 bg-white px-3 py-1.5 text-xs font-medium text-raven-900 hover:bg-seagrass-50 hover:border-seagrass-300 transition-colors"
          >
            {sq}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-apricot-200 bg-apricot-50 px-4 py-3 text-xs text-apricot-700">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Answer Section */}
          <section
            className={`rounded-lg border p-6 space-y-3 ${
              result.hasSufficientEvidence
                ? 'border-raven-800 bg-raven-900 text-white'
                : 'border-apricot-300 bg-apricot-50 text-raven-950'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3
                className={`text-xs font-semibold ${
                  result.hasSufficientEvidence ? 'text-raven-200' : 'text-apricot-700'
                }`}
              >
                Answer
              </h3>
              <StatusTag status={result.hasSufficientEvidence ? 'ACTIVE' : 'PENDING'} />
            </div>
            <p
              className={`text-base leading-relaxed ${
                result.hasSufficientEvidence ? 'text-white' : 'text-raven-950'
              }`}
            >
              {result.answer}
            </p>
          </section>

          {/* Evidence Section */}
          <section className="rounded-lg border border-seagrass-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-seagrass-200 bg-raven-50/75">
              <h3 className="text-sm font-semibold text-raven-950 font-display">
                Evidence ({result.sources.length})
              </h3>
            </div>
            {result.sources.length === 0 ? (
              <div className="p-5 text-xs text-seagrass-600">
                No matching organizational records found for this question.
              </div>
            ) : (
              <div className="divide-y divide-seagrass-100">
                {result.sources.map((src, idx) => (
                  <div key={idx} className="px-5 py-4 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-seagrass-500">
                        <span className="font-semibold text-raven-950">{src.meetingTitle}</span>
                        {src.meetingDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatShortDate(src.meetingDate)}
                            </span>
                          </>
                        )}
                        {src.speaker && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Speaker: {src.speaker}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{src.sourceType}</span>
                      </div>
                      <p className="text-sm text-seagrass-800">&ldquo;{src.excerpt}&rdquo;</p>
                    </div>
                    {src.meetingId && (
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(src.meetingId!)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-raven-700 hover:text-raven-950 whitespace-nowrap shrink-0"
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                        <span>Open Meeting</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Related Dependencies */}
          {result.relatedDependencies.length > 0 && (
            <section className="rounded-lg border border-seagrass-200 bg-white">
              <div className="px-5 py-4 border-b border-seagrass-200">
                <h3 className="text-sm font-semibold text-raven-950 font-display">
                  Related Dependencies
                </h3>
              </div>
              <div className="divide-y divide-seagrass-100">
                {result.relatedDependencies.map((dep) => (
                  <div key={dep.id} className="px-5 py-3.5 flex items-center gap-3 text-xs text-seagrass-700">
                    <GitBranch className="w-4 h-4 text-raven-700 shrink-0" />
                    <span>
                      <span className="font-medium text-raven-950">{dep.source_title}</span> (
                      {dep.source_date ?? 'no date'}) — {dep.relationship.toLowerCase().replace(/_/g, ' ')}{' '}
                      <span className="font-medium text-raven-950">{dep.target_title}</span> (
                      {dep.target_date ?? 'no date'})
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
