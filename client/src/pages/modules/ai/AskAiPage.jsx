import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PhoneFold } from '../../../components/dashboard';
import { Button, ErrorState, PageHeader, Skeleton, StatusBadge } from '../../../components/ui';
import { askAiAssistant, getAiAssistantOverview } from '../../../services/askAiService';

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

// The server writes counts as "3 item(s)". Show "3 items" or "1 item" instead.
function plainText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(\d[\d,]*)((?:\s+[A-Za-z-]+){0,3}?)\s+([A-Za-z]+)\(s\)/g, (_match, count, middle, noun) => {
      const singular = Number(count.replace(/,/g, '')) === 1;
      return `${count}${middle} ${noun}${singular ? '' : 's'}`;
    })
    .replace(/\(s\)/g, 's');
}

// Server titles arrive in Title Case. Keep acronyms, lowercase the rest.
function sentenceCase(value) {
  if (typeof value !== 'string') return value;
  return plainText(value)
    .split(' ')
    .map((word, index) => {
      if (index === 0) return word;
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (letters.length > 1 && letters === letters.toUpperCase()) return word;
      if (/[a-z][A-Z]/.test(word)) return word;
      return word.charAt(0).toLowerCase() + word.slice(1);
    })
    .join(' ');
}

function FormattedBriefingBlock({ answer, formattedBlocks }) {
  const recommended = formattedBlocks?.recommended_action;

  return (
    <div className="mt-3.5 space-y-3">
      <p className="max-w-[75ch] text-sm leading-relaxed text-ink">
        {plainText(answer)}
      </p>

      {recommended && (
        <div className="flex flex-col justify-between gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
          <div className="min-w-0 text-sm">
            <span className="font-medium text-ink">
              Recommended next step:{' '}
            </span>
            <span className="text-ink">{plainText(recommended.title)}</span>
            {recommended.detail && (
              <p className="mt-0.5 text-xs text-ink-muted-strong">{plainText(recommended.detail)}</p>
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
        <h3 className="text-sm font-semibold text-ink">{sentenceCase(section.title)}</h3>
        {section.description && (
          <p className="text-xs text-ink-muted-strong">{plainText(section.description)}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted-strong">
          {plainText(section.empty_message) || 'Nothing needs attention here.'}
        </p>
      ) : isStepsLayout ? (
        <ol aria-label={sentenceCase(section.title)} className="divide-y divide-line-soft">
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
                      {plainText(row.primary)}
                    </span>
                    {row.meta && (
                      <span className="text-xs text-ink-muted-strong tabular-nums">
                        {plainText(row.meta)}
                      </span>
                    )}
                  </div>
                  {row.secondary && (
                    <p className="text-xs leading-relaxed text-ink-muted-strong">
                      {plainText(row.secondary)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                {row.href && (
                  <Button to={row.href} variant="secondary" size="sm" className="max-sm:h-11">
                    {row.action_label || 'Go to page'}
                  </Button>
                )}
                {row.ask_question && onSelectFollowUp && (
                  <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => onSelectFollowUp(row.ask_question, 'how_to_guide')}>
                    Show steps
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <table className="block w-full text-left text-sm sm:table">
          <caption className="sr-only">{sentenceCase(section.title)}</caption>
          <thead className="hidden bg-subtle sm:table-header-group">
            <tr className="border-b border-line text-ink-muted">
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Record</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Details</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold">Count</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-line sm:table-row-group">
            {rows.map((row) => {
              const cell = 'px-3 py-0 max-sm:px-0 max-sm:empty:hidden sm:table-cell sm:py-2.5';

              return (
                <tr key={row.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 hover:bg-subtle sm:table-row sm:py-0">
                  <td data-label="Record" className={`${cell} font-medium text-ink max-sm:col-span-2 max-sm:row-start-1`}>
                    {plainText(row.primary)}
                  </td>
                  <td data-label="Details" className={`${cell} text-xs text-ink-muted-strong max-sm:col-span-3 max-sm:row-start-2 sm:text-sm`}>
                    {plainText(row.secondary) || ''}
                  </td>
                  <td data-label="Status" className={`${cell} max-sm:row-start-3 max-sm:self-center`}>
                    {row.status ? (
                      <StatusBadge tone={BADGE_TONES[row.status_tone] || row.status_tone || 'neutral'} label={plainText(row.status)} />
                    ) : ''}
                  </td>
                  <td data-label="Count" className={`${cell} tabular-nums text-ink max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-3 max-sm:self-center max-sm:text-xs`}>
                    {plainText(row.meta) || ''}
                  </td>
                  <td className={`${cell} max-sm:col-start-3 max-sm:row-start-1 sm:text-right`}>
                    {row.href ? (
                      <Button to={row.href} variant="secondary" size="sm" className="max-sm:h-11">
                        {row.action_label || 'Open'}
                      </Button>
                    ) : row.ask_question && onSelectFollowUp ? (
                      <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => onSelectFollowUp(row.ask_question, 'how_to_guide')}>
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
  const sections = Array.isArray(turn.sections) ? turn.sections : [];
  const followUps = Array.isArray(turn.follow_ups) ? turn.follow_ups : [];

  return (
    <article
      aria-label={sentenceCase(turn.title) || turn.question}
      className="rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="border-b border-line pb-3.5">
        <h2 className="text-base font-semibold text-ink">
          {sentenceCase(turn.title) || 'Answer'}
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
                <dt className="text-xs text-ink-muted-strong">{plainText(item.label)}</dt>
                <dd className={`mt-0.5 text-base font-semibold tabular-nums ${valueColor}`}>
                  {item.value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

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
              className="max-sm:h-11"
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
  const inputRef = useRef(null);

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
    if (asking) return;
    if (!questionInput.trim()) {
      inputRef.current?.focus();
      return;
    }
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
        title: dailyBriefing.title || "Today's plan",
        answer: dailyBriefing.summary,
        highlights: dailyBriefing.highlights || [],
        formatted_blocks: dailyBriefing.formatted_blocks || null,
        sections: dailyBriefing.sections || [],
        follow_ups: suggestedQuestions.slice(1, 4).map((q) => ({
          topic: q.topic,
          label: q.label,
          question: q.question,
        })),
      }
    : null;

  const suggestedQuestionList = (
    <>
      <div className="mb-2 mt-2 text-xs text-ink-muted-strong sm:mt-0">
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
            className="h-auto min-h-9 text-left max-sm:min-h-11"
          >
            {item.label}
          </Button>
        ))}
      </div>
    </>
  );
  const answerShowing = turns.length > 0 || Boolean(defaultTurn);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ask AI"
        description={overview?.scope_label ? `Showing records for ${overview.scope_label}.` : undefined}
        actions={turns.length > 0 ? (
          <Button variant="secondary" onClick={() => setTurns([])}>
            Back to today&apos;s plan
          </Button>
        ) : undefined}
      />

      <section aria-label="Ask AI prompt bar">
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <label htmlFor="ask-ai-question-input" className="sr-only">
            Ask a question about your tasks, submissions, or organization records
          </label>
          <input
            id="ask-ai-question-input"
            type="text"
            value={questionInput}
            onChange={(e) => setQuestionInput(e.target.value)}
            ref={inputRef}
            placeholder="Ask a question"
            disabled={asking}
            className="h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-soft focus:border-brand-600 sm:h-10 sm:text-sm"
          />
          <Button type="submit" loading={asking} className="shrink-0 max-sm:h-11">
            Ask AI
          </Button>
        </form>

        {askError && (
          <p role="alert" className="mt-2.5 text-sm font-medium text-danger-strong">
            {askError}
          </p>
        )}

        {suggestedQuestions.length > 0 && (answerShowing ? (
          <div className="mt-2 sm:mt-4">
            <PhoneFold label="Show suggested questions" hideLabel="Hide suggested questions" className="px-0!">
              {suggestedQuestionList}
            </PhoneFold>
          </div>
        ) : <div className="mt-4">{suggestedQuestionList}</div>)}
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
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted-strong">{plainText(item.answer)}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => runQuestion(item.question, null)}
                  className="shrink-0 self-start max-sm:h-11 sm:self-center"
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
