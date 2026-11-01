import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { askAiAssistant, getAiAssistantOverview } from '../../../services/askAiService';

const STATUS_BADGE_STYLES = {
  danger: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
  warning: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
  success: 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]',
  info: 'bg-[#E0F2FE] text-[#0284C7] border-[#BAE6FD]',
  primary: 'bg-[#EEF6FB] text-[#0F2F62] border-[#BAE6FD]',
  neutral: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
};

const BAR_FILL_STYLES = {
  danger: 'bg-[#DC2626]',
  warning: 'bg-[#D97706]',
  success: 'bg-[#16A34A]',
  info: 'bg-[#0B8ED0]',
  primary: 'bg-[#0F2F62]',
  neutral: 'bg-[#64748B]',
};

const HIGHLIGHT_TONE_STYLES = {
  danger: 'text-[#DC2626]',
  warning: 'text-[#D97706]',
  success: 'text-[#16A34A]',
  primary: 'text-[#0F2F62]',
  info: 'text-[#0B8ED0]',
  neutral: 'text-[#0F172A]',
};

function formatRichText(text) {
  if (!text) return null;
  const parts = String(text).split(/(₱[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+\b)/g);
  return parts.map((part, index) => {
    if (/^(₱[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+)$/.test(part)) {
      return (
        <strong
          key={index}
          className="rounded bg-white/80 px-1 py-0.5 font-semibold text-[#0F2F62] tabular-nums"
        >
          {part}
        </strong>
      );
    }
    return part;
  });
}

function AiVisualCharts({ charts }) {
  if (!Array.isArray(charts) || charts.length === 0) return null;

  return (
    <div
      aria-label="Visual data graphs"
      className="mt-4 grid gap-4 border-t border-[#DDE7EF] pt-4 lg:grid-cols-2"
    >
      {charts.map((chart) => {
        const items = Array.isArray(chart.items) ? chart.items : [];
        if (items.length === 0) return null;
        const isDistribution = chart.type === 'distribution';

        return (
          <div key={chart.id || chart.title} className="rounded-lg bg-[#F8FAFC] p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#0B8ED0]" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-[#0F172A]">{chart.title}</h3>
              </div>
              {chart.subtitle && (
                <span className="text-[11px] text-[#475569]">{chart.subtitle}</span>
              )}
            </div>

            {isDistribution && (
              <div
                aria-label={`${chart.title} stacked bar`}
                className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-[#E2E8F0]"
              >
                {items.map((item) => {
                  const fill = BAR_FILL_STYLES[item.tone] || BAR_FILL_STYLES.primary;
                  const widthPct = Math.max(6, Number(item.share_percent ?? item.percent ?? 10));
                  return (
                    <div
                      key={item.label}
                      title={`${item.label}: ${item.display_value} (${widthPct}%)`}
                      className={`h-full transition-all duration-300 ${fill}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  );
                })}
              </div>
            )}

            <div className="space-y-2.5">
              {items.map((item) => {
                const fill = BAR_FILL_STYLES[item.tone] || BAR_FILL_STYLES.primary;
                const widthPct = Math.max(0, Math.min(100, Number(item.percent ?? 0)));
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-[#0F172A]">
                        <span
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${fill}`}
                          aria-hidden="true"
                        />
                        {item.label}
                      </span>
                      <span className="font-semibold text-[#0F2F62] tabular-nums">
                        {item.display_value ?? item.value}
                        {item.share_percent != null ? ` (${item.share_percent}%)` : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${fill}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FormattedBriefingBlock({ answer, formattedBlocks }) {
  const recommended = formattedBlocks?.recommended_action;

  return (
    <div className="mt-3.5 space-y-3">
      <div className="rounded-lg bg-[#EEF6FB] px-4 py-3 text-sm leading-relaxed text-[#0F172A]">
        {formatRichText(answer)}
      </div>

      {recommended && (
        <div className="flex flex-col justify-between gap-2 rounded-lg bg-[#F8FAFC] px-3.5 py-2.5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-[#0F2F62]">
              Recommended next step:{' '}
            </span>
            <span className="text-xs font-medium text-[#0F172A]">{recommended.title}</span>
            {recommended.detail && (
              <span className="ml-1.5 text-xs text-[#475569]">— {recommended.detail}</span>
            )}
          </div>
          {recommended.href && (
            <Link
              to={recommended.href}
              className="inline-flex shrink-0 items-center gap-1 self-start rounded-md bg-[#0F2F62] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#0B8ED0] sm:self-center"
            >
              <span>{recommended.action_label || 'Take action'}</span>
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceSection({ section }) {
  const rows = Array.isArray(section.rows) ? section.rows : [];

  return (
    <div className="border-t border-[#DDE7EF] pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#0F172A]">{section.title}</h3>
        {section.description && (
          <p className="text-xs text-[#475569]">{section.description}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-[#F8FAFC] px-3.5 py-2.5 text-xs text-[#475569]">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" />
          <span>{section.empty_message || 'No matching records require attention.'}</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#DDE7EF]">
          <table className="w-full min-w-[540px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#DDE7EF] bg-[#F8FAFC] text-[#475569]">
                <th scope="col" className="px-3.5 py-2 font-semibold">
                  Record / Organization
                </th>
                <th scope="col" className="px-3.5 py-2 font-semibold">
                  Details &amp; Breakdown
                </th>
                <th scope="col" className="px-3.5 py-2 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3.5 py-2 font-semibold">
                  Metric / Progress
                </th>
                <th scope="col" className="px-3.5 py-2 text-right font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE7EF] bg-white">
              {rows.map((row) => {
                const badgeStyle =
                  STATUS_BADGE_STYLES[row.status_tone] || STATUS_BADGE_STYLES.neutral;
                const barFill = BAR_FILL_STYLES[row.status_tone] || BAR_FILL_STYLES.info;
                const hasProgress =
                  row.progress_percent !== null &&
                  row.progress_percent !== undefined &&
                  !Number.isNaN(Number(row.progress_percent));

                return (
                  <tr key={row.id} className="transition-colors hover:bg-[#F8FAFC]">
                    <td className="px-3.5 py-2.5 align-middle font-medium text-[#0F172A]">
                      {row.primary}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle text-[#475569]">
                      {row.secondary || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      {row.status ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeStyle}`}
                        >
                          {row.status}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      <div className="min-w-[110px] space-y-1">
                        {row.meta && (
                          <span className="block font-medium text-[#0F172A] tabular-nums">
                            {row.meta}
                          </span>
                        )}
                        {hasProgress && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                            <div
                              className={`h-full rounded-full ${barFill}`}
                              style={{
                                width: `${Math.max(4, Math.min(100, Number(row.progress_percent)))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 text-right align-middle">
                      {row.href ? (
                        <Link
                          to={row.href}
                          className="inline-flex items-center gap-1 rounded-md bg-[#EEF6FB] px-2.5 py-1 text-xs font-medium text-[#0F2F62] transition-colors hover:bg-[#DDEEF9] active:scale-[0.98]"
                        >
                          <span>{row.action_label || 'Open'}</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RagTelemetryStrip({ ragMetadata }) {
  if (!ragMetadata) {
    return null;
  }

  const concepts = Array.isArray(ragMetadata.matched_concepts)
    ? ragMetadata.matched_concepts
    : [];
  const entities = Array.isArray(ragMetadata.matched_entities)
    ? ragMetadata.matched_entities
    : [];

  return (
    <div
      aria-label="Semantic RAG retrieval telemetry"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FAFC] px-3 py-2 text-[11px] text-[#475569]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-[#0F2F62] px-2 py-0.5 font-semibold text-white">
          <Sparkles className="h-3 w-3 text-[#38BDF8]" aria-hidden="true" />
          <span>{ragMetadata.engine || 'Hybrid Semantic RAG'}</span>
        </span>
        <span className="tabular-nums">
          Indexed <strong className="text-[#0F172A]">{ragMetadata.corpus_size ?? 0}</strong> records across{' '}
          <strong className="text-[#0F172A]">{ragMetadata.domains_searched ?? 0}</strong> domains · Retrieved{' '}
          <strong className="text-[#0F172A]">{ragMetadata.retrieved_count ?? 0}</strong> matches
        </span>
        {ragMetadata.top_confidence != null && (
          <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 font-semibold text-[#166534] tabular-nums">
            {ragMetadata.top_confidence}% semantic match
          </span>
        )}
      </div>

      {(concepts.length > 0 || entities.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {entities.slice(0, 3).map((entity) => (
            <span
              key={entity}
              className="rounded-full bg-[#EEF6FB] px-2 py-0.5 font-medium text-[#0F2F62]"
            >
              Entity: {entity}
            </span>
          ))}
          {concepts.slice(0, 2).map((concept) => (
            <span
              key={concept}
              className="rounded-full bg-[#E2E8F0] px-2 py-0.5 font-medium text-[#334155]"
            >
              {concept}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ResponseTurn({ turn, onSelectFollowUp, isLatest }) {
  const highlights = Array.isArray(turn.highlights) ? turn.highlights : [];
  const charts = Array.isArray(turn.charts) ? turn.charts : [];
  const sections = Array.isArray(turn.sections) ? turn.sections : [];
  const followUps = Array.isArray(turn.follow_ups) ? turn.follow_ups : [];

  return (
    <article
      aria-label={turn.title || turn.question}
      className="rounded-xl border border-[#DDE7EF] bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#DDE7EF] pb-3.5">
        <div>
          <h2 className="text-base font-semibold text-[#0F172A]">
            {turn.title || 'AI Operational Briefing'}
          </h2>
          {turn.question && (
            <p className="mt-0.5 text-xs text-[#475569]">
              Question: &ldquo;{turn.question}&rdquo;
            </p>
          )}
        </div>
        {isLatest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF6FB] px-2.5 py-0.5 text-xs font-medium text-[#0F2F62]">
            <Sparkles className="h-3.5 w-3.5 text-[#0B8ED0]" aria-hidden="true" />
            Semantic RAG Live
          </span>
        )}
      </div>

      <RagTelemetryStrip ragMetadata={turn.rag_metadata} />

      <FormattedBriefingBlock
        answer={turn.answer}
        formattedBlocks={turn.formatted_blocks}
      />

      {highlights.length > 0 && (
        <dl className="mt-3.5 grid grid-cols-2 gap-2.5 border-t border-[#DDE7EF] pt-3.5 sm:grid-cols-4">
          {highlights.map((item) => {
            const valueColor =
              HIGHLIGHT_TONE_STYLES[item.tone] || HIGHLIGHT_TONE_STYLES.neutral;
            return (
              <div key={item.label} className="rounded-lg bg-[#F8FAFC] px-3 py-2">
                <dt className="text-[11px] font-medium text-[#475569]">{item.label}</dt>
                <dd className={`mt-0.5 text-base font-bold tabular-nums ${valueColor}`}>
                  {item.value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      <AiVisualCharts charts={charts} />

      {sections.length > 0 && (
        <div className="mt-4 space-y-4">
          {sections.map((section) => (
            <EvidenceSection key={section.id || section.title} section={section} />
          ))}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#DDE7EF] pt-3.5">
          <span className="text-xs font-medium text-[#475569]">Ask next:</span>
          {followUps.map((f) => (
            <button
              key={f.question}
              type="button"
              onClick={() => onSelectFollowUp(f.question, f.topic)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE7EF] bg-[#F8FAFC] px-3 py-1 text-xs font-medium text-[#0F2F62] transition-colors hover:border-[#0B8ED0] hover:bg-[#EEF6FB] active:scale-[0.98]"
            >
              <span>{f.label}</span>
              <ArrowRight className="h-3 w-3 text-[#0B8ED0]" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export default function AskAiPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState(null);

  const [questionInput, setQuestionInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);
  const [turns, setTurns] = useState([]);

  const initialQueryHandledRef = useRef(false);

  const runQuestion = useCallback(async (questionText, topic = null) => {
    const trimmed = (questionText || '').trim();
    if (!trimmed) return;

    setAsking(true);
    setAskError(null);
    try {
      const response = await askAiAssistant({
        question: trimmed,
        ...(topic ? { topic } : {}),
      });
      const data = response.data;
      setTurns((prev) => [data, ...prev]);
      setQuestionInput('');
    } catch (err) {
      setAskError(
        err?.response?.data?.message ||
          'Unable to process your question right now. Please try again.'
      );
    } finally {
      setAsking(false);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const response = await getAiAssistantOverview();
      setOverview(response.data);
    } catch {
      setOverviewError('Could not load the AI Assistant briefing. Please try again.');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (initialQueryHandledRef.current) return;
    const qParam = searchParams.get('q');
    const topicParam = searchParams.get('topic');
    if (qParam && qParam.trim()) {
      initialQueryHandledRef.current = true;
      runQuestion(qParam.trim(), topicParam || null);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, runQuestion]);

  const handleFormSubmit = (event) => {
    event.preventDefault();
    if (!questionInput.trim() || asking) return;
    runQuestion(questionInput, null);
  };

  if (loadingOverview) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl bg-[#EEF6FB]" />
        <div className="h-64 animate-pulse rounded-xl bg-[#EEF6FB]" />
      </div>
    );
  }

  if (overviewError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DDE7EF] bg-white p-4 text-sm text-[#0F172A]"
      >
        <span>{overviewError}</span>
        <button
          type="button"
          onClick={loadOverview}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B8ED0] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0978B2]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  const suggestedQuestions = Array.isArray(overview?.suggested_questions)
    ? overview.suggested_questions
    : [];
  const dailyBriefing = overview?.daily_briefing;
  const recentQueries = Array.isArray(overview?.recent_queries) ? overview.recent_queries : [];

  const defaultTurn = dailyBriefing
    ? {
        id: 'daily-briefing',
        question: 'What should I do today?',
        title: dailyBriefing.title || "Today's Action Plan",
        answer: dailyBriefing.summary,
        highlights: dailyBriefing.highlights || [],
        formatted_blocks: dailyBriefing.formatted_blocks || null,
        charts: dailyBriefing.charts || [],
        rag_metadata: dailyBriefing.rag_metadata || null,
        sections: dailyBriefing.sections || [],
        follow_ups: suggestedQuestions.slice(1, 4).map((q) => ({
          topic: q.topic,
          label: q.label,
          question: q.question,
        })),
      }
    : null;

  return (
    <div className="space-y-5">
      <section
        aria-label="Ask AI prompt bar"
        className="rounded-xl border border-[#DDE7EF] bg-white p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#0F172A]">
                {overview?.role_label || 'Ask AI Assistant'}
              </h1>
              <p className="text-xs text-[#475569]">
                Scope: <span className="font-medium text-[#0F172A]">{overview?.scope_label}</span> · Hybrid Semantic Search &amp; RAG over live records
              </p>
            </div>
          </div>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => setTurns([])}
              className="rounded-lg border border-[#DDE7EF] px-2.5 py-1 text-xs font-medium text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
            >
              Reset to today&apos;s plan
            </button>
          )}
        </div>

        <form onSubmit={handleFormSubmit} className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <label htmlFor="ask-ai-question-input" className="sr-only">
            Ask a question about your tasks, submissions, or organization records
          </label>
          <input
            id="ask-ai-question-input"
            type="text"
            value={questionInput}
            onChange={(e) => setQuestionInput(e.target.value)}
            placeholder="Ask anything: officers, specific organizations, merchandise stock, ledger expenses, venues, compliance..."
            disabled={asking}
            className="min-h-[42px] flex-1 rounded-lg border border-[#DDE7EF] bg-[#F8FAFC] px-3.5 py-2 text-base text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0B8ED0] focus:bg-white focus:outline-none sm:text-sm"
          />
          <button
            type="submit"
            disabled={asking || !questionInput.trim()}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0978B2] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span>{asking ? 'Analyzing...' : 'Ask AI'}</span>
          </button>
        </form>

        {askError && (
          <p role="alert" className="mt-2.5 text-xs font-medium text-[#DC2626]">
            {askError}
          </p>
        )}

        {suggestedQuestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-[#475569]">
              Suggested questions for your role:
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={asking}
                  onClick={() => runQuestion(item.question, item.topic)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDE7EF] bg-[#F8FAFC] px-3 py-1.5 text-left text-xs font-medium text-[#0F2F62] transition-colors hover:border-[#0B8ED0] hover:bg-[#EEF6FB] active:scale-[0.98] disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#0B8ED0]" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="space-y-4">
        {turns.map((turn, idx) => (
          <ResponseTurn
            key={`${turn.id || 'turn'}-${idx}`}
            turn={turn}
            isLatest={idx === 0}
            onSelectFollowUp={(q, topic) => runQuestion(q, topic)}
          />
        ))}

        {defaultTurn && (
          <ResponseTurn
            turn={defaultTurn}
            isLatest={turns.length === 0}
            onSelectFollowUp={(q, topic) => runQuestion(q, topic)}
          />
        )}
      </div>

      {recentQueries.length > 0 && (
        <section
          aria-label="Recent AI questions"
          className="rounded-xl border border-[#DDE7EF] bg-white p-4 sm:p-5"
        >
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#475569]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#0F172A]">Recent Questions You Asked</h2>
          </div>
          <div className="divide-y divide-[#DDE7EF]">
            {recentQueries.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#0F172A]">{item.question}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-[#475569]">{item.answer}</p>
                </div>
                <button
                  type="button"
                  onClick={() => runQuestion(item.question, null)}
                  className="shrink-0 self-start rounded-md bg-[#EEF6FB] px-2.5 py-1 text-xs font-medium text-[#0F2F62] hover:bg-[#DDEEF9] sm:self-center"
                >
                  Ask again
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
