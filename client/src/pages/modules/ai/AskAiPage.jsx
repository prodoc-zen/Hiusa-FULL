import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, CheckCircle2 } from 'lucide-react';
import { Button, ErrorState, PageHeader, Skeleton, StatusBadge } from '../../../components/ui';
import { askAiAssistant, getAiAssistantOverview } from '../../../services/askAiService';

const BAR_FILL_STYLES = {
  danger: 'bg-danger',
  warning: 'bg-warning-strong',
  success: 'bg-success',
  info: 'bg-brand-600',
  primary: 'bg-navy-800',
  neutral: 'bg-ink-muted',
};

const HIGHLIGHT_TONE_STYLES = {
  danger: 'text-danger-strong',
  warning: 'text-warning-strong',
  success: 'text-success-strong',
  primary: 'text-navy-800',
  info: 'text-brand-700',
  neutral: 'text-ink',
};

// The server names tones the old way; the badge knows info, not primary.
const BADGE_TONES = { primary: 'info' };

function formatRichText(text) {
  if (!text) return null;
  const parts = String(text).split(/(₱[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+\b)/g);
  return parts.map((part, index) => {
    if (/^(₱[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+)$/.test(part)) {
      return (
        <strong key={index} className="font-semibold text-ink tabular-nums">
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
          <div key={chart.id || chart.title}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-ink">{chart.title}</h3>
              </div>
              {chart.subtitle && (
                <span className="text-xs text-ink-muted-strong">{chart.subtitle}</span>
              )}
            </div>

            {isDistribution && (
              <div
                aria-label={`${chart.title} stacked bar`}
                className="mb-3 flex h-3 w-full overflow-hidden rounded bg-line-soft"
              >
                {items.map((item) => {
                  const fill = BAR_FILL_STYLES[item.tone] || BAR_FILL_STYLES.primary;
                  const widthPct = Math.max(6, Number(item.share_percent ?? item.percent ?? 10));
                  return (
                    <div
                      key={item.label}
                      title={`${item.label}: ${item.display_value} (${widthPct}%)`}
                      className={`h-full ${fill}`}
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
                      <span className="flex items-center gap-1.5 text-ink">
                        <span
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${fill}`}
                          aria-hidden="true"
                        />
                        {item.label}
                      </span>
                      <span className="font-medium text-ink tabular-nums">
                        {item.display_value ?? item.value}
                        {item.share_percent != null ? ` (${item.share_percent}%)` : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-line-soft">
                      <div
                        className={`h-full rounded ${fill}`}
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
      <p className="max-w-[75ch] text-sm leading-relaxed text-ink">
        {formatRichText(answer)}
      </p>

      {recommended && (
        <div className="flex flex-col justify-between gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
          <div className="min-w-0 text-sm">
            <span className="font-medium text-ink">
              Recommended next step:{' '}
            </span>
            <span className="text-ink">{recommended.title}</span>
            {recommended.detail && (
              <p className="mt-0.5 text-xs text-ink-muted-strong">{recommended.detail}</p>
            )}
          </div>
          {recommended.href && (
            <Button to={recommended.href} variant="secondary" size="sm" className="shrink-0 self-start sm:self-center">
              {recommended.action_label || 'Take action'}
            </Button>
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
        <p className="flex items-center gap-2 text-sm text-ink-muted-strong">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <span>{section.empty_message || 'No matching records require attention.'}</span>
        </p>
      ) : isStepsLayout ? (
        <ol aria-label={section.title} className="divide-y divide-line-soft">
          {rows.map((row, idx) => (
            <li
              key={row.id || idx}
              className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white"
                >
                  {row.step || idx + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {row.primary}
                    </span>
                    {row.meta && (
                      <span className="text-xs text-ink-muted-strong tabular-nums">
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
                  <Button to={row.href} variant="secondary" size="sm">
                    {row.action_label || 'Go to page'}
                  </Button>
                )}
                {row.ask_question && onSelectFollowUp && (
                  <Button variant="secondary" size="sm" onClick={() => onSelectFollowUp(row.ask_question, 'how_to_guide')}>
                    Show steps
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <table className="block w-full text-left text-sm sm:table">
          <caption className="sr-only">{section.title}</caption>
          <thead className="hidden bg-subtle sm:table-header-group">
            <tr className="border-b border-line text-ink-muted">
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Record</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Details</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Progress</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-line sm:table-row-group">
            {rows.map((row) => {
              const barFill = BAR_FILL_STYLES[row.status_tone] || BAR_FILL_STYLES.info;
              const hasProgress =
                row.progress_percent !== null &&
                row.progress_percent !== undefined &&
                !Number.isNaN(Number(row.progress_percent));
              const cell = 'flex items-center justify-between gap-3 px-3 py-1.5 before:text-xs before:text-ink-muted before:content-[attr(data-label)] sm:table-cell sm:py-2.5 sm:before:hidden';

              return (
                <tr key={row.id} className="block py-2 hover:bg-subtle sm:table-row sm:py-0">
                  <td data-label="Record" className={`${cell} font-medium text-ink`}>
                    {row.primary}
                  </td>
                  <td data-label="Details" className={`${cell} text-ink-muted-strong`}>
                    {row.secondary || ''}
                  </td>
                  <td data-label="Status" className={cell}>
                    {row.status ? (
                      <StatusBadge tone={BADGE_TONES[row.status_tone] || row.status_tone || 'neutral'} label={row.status} />
                    ) : ''}
                  </td>
                  <td data-label="Progress" className={cell}>
                    <div className="min-w-[110px] space-y-1">
                      {row.meta && (
                        <span className="block text-ink tabular-nums">
                          {row.meta}
                        </span>
                      )}
                      {hasProgress && (
                        <div className="h-1.5 w-full overflow-hidden rounded bg-line-soft">
                          <div
                            className={`h-full rounded ${barFill}`}
                            style={{
                              width: `${Math.max(4, Math.min(100, Number(row.progress_percent)))}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className={`${cell} sm:text-right`}>
                    {row.href ? (
                      <Button to={row.href} variant="secondary" size="sm">
                        {row.action_label || 'Open'}
                      </Button>
                    ) : row.ask_question && onSelectFollowUp ? (
                      <Button variant="secondary" size="sm" onClick={() => onSelectFollowUp(row.ask_question, 'how_to_guide')}>
                        Show steps
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ResponseTurn({ turn, onSelectFollowUp }) {
  const highlights = Array.isArray(turn.highlights) ? turn.highlights : [];
  const charts = Array.isArray(turn.charts) ? turn.charts : [];
  const sections = Array.isArray(turn.sections) ? turn.sections : [];
  const followUps = Array.isArray(turn.follow_ups) ? turn.follow_ups : [];

  return (
    <article
      aria-label={turn.title || turn.question}
      className="rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="border-b border-line pb-3.5">
        <h2 className="text-base font-semibold text-ink">
          {turn.title || 'Briefing'}
        </h2>
        {turn.question && (
          <p className="mt-0.5 text-xs text-ink-muted-strong">
            Question: &ldquo;{turn.question}&rdquo;
          </p>
        )}
      </div>

      <FormattedBriefingBlock
        answer={turn.answer}
        formattedBlocks={turn.formatted_blocks}
      />

      {highlights.length > 0 && (
        <dl className="mt-3.5 flex flex-wrap gap-x-8 gap-y-3 border-t border-line pt-3.5">
          {highlights.map((item) => {
            const valueColor =
              HIGHLIGHT_TONE_STYLES[item.tone] || HIGHLIGHT_TONE_STYLES.neutral;
            return (
              <div key={item.label}>
                <dt className="text-xs text-ink-muted-strong">{item.label}</dt>
                <dd className={`mt-0.5 text-base font-semibold tabular-nums ${valueColor}`}>
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
          <span className="text-xs text-ink-muted-strong">Ask next:</span>
          {followUps.map((f) => (
            <Button
              key={f.question}
              variant="secondary"
              size="sm"
              onClick={() => onSelectFollowUp(f.question, f.topic)}
            >
              {f.label}
            </Button>
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
          'Could not answer that question right now. Try again.'
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
      setOverviewError('Could not load your briefing. Try again.');
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
      <div className="space-y-5">
        <PageHeader title="Ask AI" />
        <div className="space-y-3" role="status" aria-label="Loading your briefing">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (overviewError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Ask AI" />
        <ErrorState title="Could not load Ask AI" description={overviewError} onRetry={loadOverview} />
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
        title: dailyBriefing.title || "Today's action plan",
        answer: dailyBriefing.summary,
        highlights: dailyBriefing.highlights || [],
        formatted_blocks: dailyBriefing.formatted_blocks || null,
        charts: dailyBriefing.charts || [],
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
      <PageHeader
        title="Ask AI"
        description={overview?.scope_label ? `Answers come from live records for ${overview.scope_label}.` : undefined}
        actions={turns.length > 0 ? (
          <Button variant="secondary" onClick={() => setTurns([])}>
            Back to today&apos;s plan
          </Button>
        ) : undefined}
      />

      <section aria-label="Ask AI prompt bar">
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-2.5 sm:flex-row">
          <label htmlFor="ask-ai-question-input" className="sr-only">
            Ask a question about your tasks, submissions, or organization records
          </label>
          <input
            id="ask-ai-question-input"
            type="text"
            value={questionInput}
            onChange={(e) => setQuestionInput(e.target.value)}
            placeholder="Ask about officers, organizations, merchandise, expenses, venues or compliance"
            disabled={asking}
            className="h-10 flex-1 rounded-control border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-soft focus:border-brand-600 sm:text-sm"
          />
          <Button type="submit" loading={asking} disabled={!questionInput.trim()}>
            Ask AI
          </Button>
        </form>

        {askError && (
          <p role="alert" className="mt-2.5 text-sm font-medium text-danger-strong">
            {askError}
          </p>
        )}

        {suggestedQuestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs text-ink-muted-strong">
              Suggested questions
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((item) => (
                <Button
                  key={item.id}
                  variant="secondary"
                  size="sm"
                  disabled={asking}
                  onClick={() => runQuestion(item.question, item.topic)}
                  className="h-auto min-h-9 text-left"
                >
                  {item.label}
                </Button>
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
            onSelectFollowUp={(q, topic) => runQuestion(q, topic)}
          />
        ))}

        {defaultTurn && (
          <ResponseTurn
            turn={defaultTurn}
            onSelectFollowUp={(q, topic) => runQuestion(q, topic)}
          />
        )}
      </div>

      {recentQueries.length > 0 && (
        <section
          aria-label="Recent questions"
          className="rounded-card border border-line bg-surface p-4 sm:p-5"
        >
          <h2 className="mb-3 text-sm font-semibold text-ink">Recent questions</h2>
          <div className="divide-y divide-line">
            {recentQueries.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{item.question}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted-strong">{item.answer}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => runQuestion(item.question, null)}
                  className="shrink-0 self-start sm:self-center"
                >
                  Ask again
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
