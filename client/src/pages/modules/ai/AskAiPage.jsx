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
  danger: 'bg-danger-tint text-danger border-danger/30',
  warning: 'bg-warning-tint text-warning-strong border-warning/30',
  success: 'bg-success-tint text-success border-success/30',
  info: 'bg-brand-50 text-brand-700 border-brand-100',
  primary: 'bg-page text-navy-800 border-brand-100',
  neutral: 'bg-subtle text-ink-muted-strong border-line-soft',
};

const BAR_FILL_STYLES = {
  danger: 'bg-danger',
  warning: 'bg-warning-strong',
  success: 'bg-success',
  info: 'bg-brand-600',
  primary: 'bg-navy-800',
  neutral: 'bg-ink-muted',
};

const HIGHLIGHT_TONE_STYLES = {
  danger: 'text-danger',
  warning: 'text-warning-strong',
  success: 'text-success',
  primary: 'text-navy-800',
  info: 'text-brand-600',
  neutral: 'text-ink',
};

function formatRichText(text) {
  if (!text) return null;
  const parts = String(text).split(/(₱[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+\b)/g);
  return parts.map((part, index) => {
    if (/^(₱[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+)$/.test(part)) {
      return (
        <strong
          key={index}
          className="rounded bg-white/80 px-1 py-0.5 font-semibold text-navy-800 tabular-nums"
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
      className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2"
    >
      {charts.map((chart) => {
        const items = Array.isArray(chart.items) ? chart.items : [];
        if (items.length === 0) return null;
        const isDistribution = chart.type === 'distribution';

        return (
          <div key={chart.id || chart.title} className="rounded-lg bg-subtle p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-brand-600" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-ink">{chart.title}</h3>
              </div>
              {chart.subtitle && (
                <span className="text-xs text-ink-muted-strong">{chart.subtitle}</span>
              )}
            </div>

            {isDistribution && (
              <div
                aria-label={`${chart.title} stacked bar`}
                className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-line-soft"
              >
                {items.map((item) => {
                  const fill = BAR_FILL_STYLES[item.tone] || BAR_FILL_STYLES.primary;
                  const widthPct = Math.max(6, Number(item.share_percent ?? item.percent ?? 10));
                  return (
                    <div
                      key={item.label}
                      title={`${item.label}: ${item.display_value} (${widthPct}%)`}
                      className={`h-full transition-[background-color,color,border-color,transform] duration-300 ${fill}`}
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
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        <span
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${fill}`}
                          aria-hidden="true"
                        />
                        {item.label}
                      </span>
                      <span className="font-semibold text-navy-800 tabular-nums">
                        {item.display_value ?? item.value}
                        {item.share_percent != null ? ` (${item.share_percent}%)` : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-line-soft">
                      <div
                        className={`h-full rounded-full transition-[background-color,color,border-color,transform] duration-300 ${fill}`}
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
      <div className="rounded-lg bg-page px-4 py-3 text-sm leading-relaxed text-ink">
        {formatRichText(answer)}
      </div>

      {recommended && (
        <div className="flex flex-col justify-between gap-2 rounded-lg bg-subtle px-3.5 py-2.5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-navy-800">
              Recommended next step:{' '}
            </span>
            <span className="text-xs font-medium text-ink">{recommended.title}</span>
            {recommended.detail && (
              <span className="ml-1.5 text-xs text-ink-muted-strong">— {recommended.detail}</span>
            )}
          </div>
          {recommended.href && (
            <Link
              to={recommended.href}
              className="inline-flex shrink-0 items-center gap-1 self-start rounded-md bg-navy-800 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600 sm:self-center"
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

function EvidenceSection({ section, onSelectFollowUp }) {
  const rows = Array.isArray(section.rows) ? section.rows : [];
  const isStepsLayout = section.layout === 'steps';

  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{section.title}</h3>
        {section.description && (
          <p className="text-xs text-ink-muted-strong">{section.description}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-subtle px-3.5 py-2.5 text-xs text-ink-muted-strong">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <span>{section.empty_message || 'No matching records require attention.'}</span>
        </div>
      ) : isStepsLayout ? (
        <ol aria-label={section.title} className="space-y-2.5">
          {rows.map((row, idx) => (
            <li
              key={row.id || idx}
              className="flex flex-col gap-3 rounded-lg border border-line bg-white p-3.5 transition-colors hover:border-brand-100 hover:bg-subtle/60 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white shadow-xs"
                >
                  {row.step || idx + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink">
                      {row.primary}
                    </span>
                    {row.meta && (
                      <span className="inline-flex items-center rounded-full bg-page px-2 py-0.5 text-xs font-medium text-navy-800">
                        {row.meta}
                      </span>
                    )}
                  </div>
                  {row.secondary && (
                    <p className="text-xs leading-relaxed text-ink-muted-strong">
                      {row.secondary}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                {row.href && (
                  <Link
                    to={row.href}
                    className="inline-flex items-center gap-1 rounded-md bg-navy-800 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600 active:scale-[0.98]"
                  >
                    <span>{row.action_label || 'Go to page'}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                )}
                {row.ask_question && onSelectFollowUp && (
                  <button
                    type="button"
                    onClick={() => onSelectFollowUp(row.ask_question, 'how_to_guide')}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-navy-800 hover:bg-page"
                  >
                    <span>Show steps</span>
                    <ArrowRight className="h-3 w-3 text-brand-600" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[540px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-subtle text-ink-muted-strong">
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
            <tbody className="divide-y divide-line bg-white">
              {rows.map((row) => {
                const badgeStyle =
                  STATUS_BADGE_STYLES[row.status_tone] || STATUS_BADGE_STYLES.neutral;
                const barFill = BAR_FILL_STYLES[row.status_tone] || BAR_FILL_STYLES.info;
                const hasProgress =
                  row.progress_percent !== null &&
                  row.progress_percent !== undefined &&
                  !Number.isNaN(Number(row.progress_percent));

                return (
                  <tr key={row.id} className="transition-colors hover:bg-subtle">
                    <td className="px-3.5 py-2.5 align-middle font-medium text-ink">
                      {row.primary}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle text-ink-muted-strong">
                      {row.secondary || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      {row.status ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeStyle}`}
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
                          <span className="block font-medium text-ink tabular-nums">
                            {row.meta}
                          </span>
                        )}
                        {hasProgress && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
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
                          className="inline-flex items-center gap-1 rounded-md bg-page px-2.5 py-1 text-xs font-medium text-navy-800 transition-colors hover:bg-brand-50 active:scale-[0.98]"
                        >
                          <span>{row.action_label || 'Open'}</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : row.ask_question && onSelectFollowUp ? (
                        <button
                          type="button"
                          onClick={() => onSelectFollowUp(row.ask_question, 'how_to_guide')}
                          className="inline-flex items-center gap-1 rounded-md bg-page px-2.5 py-1 text-xs font-medium text-navy-800 hover:bg-brand-50"
                        >
                          <span>Show steps</span>
                          <ArrowRight className="h-3 w-3 text-brand-600" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-ink-soft">—</span>
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
      className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-xs text-ink-muted-strong"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-navy-800 px-2 py-0.5 font-semibold text-white">
          <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
          <span>{ragMetadata.engine || 'Hybrid Semantic RAG'}</span>
        </span>
        <span className="tabular-nums">
          Indexed <strong className="text-ink">{ragMetadata.corpus_size ?? 0}</strong> records across{' '}
          <strong className="text-ink">{ragMetadata.domains_searched ?? 0}</strong> domains · Retrieved{' '}
          <strong className="text-ink">{ragMetadata.retrieved_count ?? 0}</strong> matches
        </span>
        {ragMetadata.top_confidence != null && (
          <span className="rounded bg-success-tint px-1.5 py-0.5 font-semibold text-success-strong tabular-nums">
            {ragMetadata.top_confidence}% semantic match
          </span>
        )}
      </div>

      {(concepts.length > 0 || entities.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {entities.slice(0, 3).map((entity) => (
            <span
              key={entity}
              className="rounded-full bg-page px-2 py-0.5 font-medium text-navy-800"
            >
              Entity: {entity}
            </span>
          ))}
          {concepts.slice(0, 2).map((concept) => (
            <span
              key={concept}
              className="rounded-full bg-line-soft px-2 py-0.5 font-medium text-ink-muted-strong"
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
      className="rounded-card border border-line bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3.5">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {turn.title || 'AI Operational Briefing'}
          </h2>
          {turn.question && (
            <p className="mt-0.5 text-xs text-ink-muted-strong">
              Question: &ldquo;{turn.question}&rdquo;
            </p>
          )}
        </div>
        {isLatest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-0.5 text-xs font-medium text-navy-800">
            <Sparkles className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
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
        <dl className="mt-3.5 grid grid-cols-2 gap-2.5 border-t border-line pt-3.5 sm:grid-cols-4">
          {highlights.map((item) => {
            const valueColor =
              HIGHLIGHT_TONE_STYLES[item.tone] || HIGHLIGHT_TONE_STYLES.neutral;
            return (
              <div key={item.label} className="rounded-lg bg-subtle px-3 py-2">
                <dt className="text-xs font-medium text-ink-muted-strong">{item.label}</dt>
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
            <EvidenceSection
              key={section.id || section.title}
              section={section}
              onSelectFollowUp={onSelectFollowUp}
            />
          ))}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
          <span className="text-xs font-medium text-ink-muted-strong">Ask next:</span>
          {followUps.map((f) => (
            <button
              key={f.question}
              type="button"
              onClick={() => onSelectFollowUp(f.question, f.topic)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1 text-xs font-medium text-navy-800 transition-colors hover:border-brand-600 hover:bg-page active:scale-[0.98]"
            >
              <span>{f.label}</span>
              <ArrowRight className="h-3 w-3 text-brand-600" aria-hidden="true" />
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
        <div className="h-32 animate-pulse rounded-card bg-page" />
        <div className="h-64 animate-pulse rounded-card bg-page" />
      </div>
    );
  }

  if (overviewError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white p-4 text-sm text-ink"
      >
        <span>{overviewError}</span>
        <button
          type="button"
          onClick={loadOverview}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
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
        className="rounded-card border border-line bg-white p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-page text-brand-600">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-ink">
                {overview?.role_label || 'Ask AI Assistant'}
              </h1>
              <p className="text-xs text-ink-muted-strong">
                Scope: <span className="font-medium text-ink">{overview?.scope_label}</span> · Hybrid Semantic Search &amp; RAG over live records
              </p>
            </div>
          </div>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => setTurns([])}
              className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-muted-strong hover:bg-subtle hover:text-ink"
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
            className="min-h-[42px] flex-1 rounded-lg border border-line bg-subtle px-3.5 py-2 text-base text-ink placeholder:text-ink-muted focus:border-brand-600 focus:bg-white focus:outline-none sm:text-sm"
          />
          <button
            type="submit"
            disabled={asking || !questionInput.trim()}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span>{asking ? 'Analyzing...' : 'Ask AI'}</span>
          </button>
        </form>

        {askError && (
          <p role="alert" className="mt-2.5 text-xs font-medium text-danger">
            {askError}
          </p>
        )}

        {suggestedQuestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-ink-muted-strong">
              Suggested questions for your role:
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={asking}
                  onClick={() => runQuestion(item.question, item.topic)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-subtle px-3 py-1.5 text-left text-xs font-medium text-navy-800 transition-colors hover:border-brand-600 hover:bg-page active:scale-[0.98] disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
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
          className="rounded-card border border-line bg-white p-4 sm:p-5"
        >
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-ink-muted-strong" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-ink">Recent Questions You Asked</h2>
          </div>
          <div className="divide-y divide-line">
            {recentQueries.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-ink">{item.question}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted-strong">{item.answer}</p>
                </div>
                <button
                  type="button"
                  onClick={() => runQuestion(item.question, null)}
                  className="shrink-0 self-start rounded-md bg-page px-2.5 py-1 text-xs font-medium text-navy-800 hover:bg-brand-50 sm:self-center"
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
