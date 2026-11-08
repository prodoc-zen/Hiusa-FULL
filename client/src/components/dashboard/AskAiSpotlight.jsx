import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CheckCircle2, X } from 'lucide-react';
import { askAiAssistant } from '../../services/askAiService';

const PROMPTS_BY_ROLE = {
  SUPER_ADMIN: [
    {
      label: 'What to do today',
      topic: 'daily_priorities',
      question: 'What should I do today across student organizations?',
    },
    {
      label: "Who hasn't submitted requirements?",
      topic: 'missing_submissions',
      question: "Which organizations haven't submitted compliance or financial reports?",
    },
    {
      label: 'Who submitted files for review?',
      topic: 'submitted_documents',
      question: 'Who has submitted compliance documents or reports for review?',
    },
    {
      label: 'Organizations needing an admin',
      topic: 'organizations_without_admin',
      question: 'Which active organizations still need an administrator or were returned?',
    },
    {
      label: 'How to create an organization',
      topic: 'how_to_guide',
      question: 'How do I create an organization as SAO?',
    },
    {
      label: 'Invite Dean via magic link',
      topic: 'how_to_guide',
      question: 'How do I invite a dean with a magic link?',
    },
  ],
  DEPARTMENT_HEAD: [
    {
      label: 'What to do today',
      topic: 'daily_priorities',
      question: 'What should I do today for my college?',
    },
    {
      label: "Which college orgs haven't submitted?",
      topic: 'missing_submissions',
      question: "Which college organizations haven't submitted compliance or financial reports?",
    },
    {
      label: 'Who submitted files or reports?',
      topic: 'submitted_documents',
      question: 'Who has submitted budgets, events, or financial reports for my review?',
    },
    {
      label: 'Pending college approvals',
      topic: 'pending_approvals',
      question: 'What requests are waiting for my approval right now?',
    },
    {
      label: 'How to endorse an application',
      topic: 'how_to_guide',
      question: 'How do I endorse an organization application?',
    },
    {
      label: 'Sub-account oversight guide',
      topic: 'how_to_guide',
      question: 'How do I oversee organizations as sub-accounts?',
    },
    {
      label: 'Delegate college secretary',
      topic: 'how_to_guide',
      question: 'How do I add office staff or delegate a secretary?',
    },
  ],
  ADMIN: [
    {
      label: 'What to do today',
      topic: 'daily_priorities',
      question: 'What should I do today for our organization?',
    },
    {
      label: "What haven't we submitted?",
      topic: 'missing_submissions',
      question: "What compliance requirements, event files, or reports haven't we submitted?",
    },
    {
      label: 'What have we submitted?',
      topic: 'submitted_documents',
      question: 'What documents and reports have we already submitted?',
    },
    {
      label: 'Who has overdue tasks?',
      topic: 'tasks_workload',
      question: 'Who has overdue or pending tasks in our organization?',
    },
    {
      label: 'How to create an event',
      topic: 'how_to_guide',
      question: 'How do I create an event and submit requirements?',
    },
    {
      label: 'Plan upcoming terms in advance',
      topic: 'how_to_guide',
      question: 'How do I switch academic periods for advance planning?',
    },
  ],
  SBO_OFFICER: [
    {
      label: 'What to do today',
      topic: 'daily_priorities',
      question: 'What should I do today as an officer?',
    },
    {
      label: 'My overdue & active tasks',
      topic: 'tasks_workload',
      question: 'What tasks are assigned to me or overdue?',
    },
    {
      label: 'Orders needing verification',
      topic: 'merchandise_orders',
      question: 'Which merchandise orders need payment verification or claiming?',
    },
    {
      label: 'Missing compliance & event files',
      topic: 'missing_submissions',
      question: 'Which event requirements or compliance documents are still missing?',
    },
    {
      label: 'How to verify orders',
      topic: 'how_to_guide',
      question: 'How do I verify merchandise orders and release items?',
    },
  ],
  STUDENT: [
    {
      label: 'What to do today',
      topic: 'daily_priorities',
      question: 'What do I need to do today?',
    },
    {
      label: "Who hasn't signed my clearance?",
      topic: 'clearances_status',
      question: "Who hasn't signed my clearance yet and why?",
    },
    {
      label: 'What fees do I owe?',
      topic: 'finance_health',
      question: 'What fees or invoices do I still need to pay?',
    },
    {
      label: 'Status of my orders',
      topic: 'merchandise_orders',
      question: 'What is the status of my merchandise orders?',
    },
    {
      label: 'How to check clearance',
      topic: 'how_to_guide',
      question: 'How do I check my clearance and settle holds?',
    },
  ],
};

const BAR_FILL_STYLES = {
  danger: 'bg-danger',
  warning: 'bg-warning-strong',
  success: 'bg-success',
  info: 'bg-brand-600',
  primary: 'bg-navy-800',
  neutral: 'bg-ink-muted',
};

const STATUS_BADGE_STYLES = {
  danger: 'bg-danger-tint text-danger border-danger/30',
  warning: 'bg-warning-tint text-warning-strong border-warning/30',
  success: 'bg-success-tint text-success border-success/30',
  info: 'bg-brand-50 text-brand-700 border-brand-100',
  neutral: 'bg-subtle text-ink-muted-strong border-line-soft',
};

export default function AskAiSpotlight({ role = 'STUDENT' }) {
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const prompts = PROMPTS_BY_ROLE[role] || PROMPTS_BY_ROLE.STUDENT;

  const executeInlineAsk = async (questionText, topic = null) => {
    const trimmed = (questionText || '').trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setError(null);
    try {
      const response = await askAiAssistant({
        question: trimmed,
        ...(topic ? { topic } : {}),
      });
      setResult(response.data);
      setQuery('');
    } catch {
      setError('Unable to load AI answer right now.');
    } finally {
      setAsking(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    executeInlineAsk(query.trim(), null);
  };

  const primaryChart = Array.isArray(result?.charts) ? result.charts[0] : null;
  const primarySection = Array.isArray(result?.sections) ? result.sections[0] : null;
  const previewRows = Array.isArray(primarySection?.rows)
    ? primarySection.rows.slice(0, 5)
    : [];

  return (
    <section
      aria-label="Ask AI assistant"
      className="rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Ask AI</h2>
            <p className="text-xs text-ink-muted-strong">
              Check what needs action today, who hasn&apos;t submitted requirements, or view formatted graphs and rows.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/dashboard/ask-ai"
            className="inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
          >
            <span>Open Ask AI</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`dashboard-ask-ai-${role}`} className="sr-only">
          Ask AI a question
        </label>
        <input
          id={`dashboard-ask-ai-${role}`}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={asking}
          placeholder="Ask e.g. What should I do today? or Who hasn't submitted requirements?"
          className="min-h-[38px] flex-1 rounded-lg border border-line bg-subtle px-3 py-1.5 text-base text-ink placeholder:text-ink-muted focus:border-brand-600 focus:bg-white focus:outline-none sm:text-xs"
        />
        <button
          type="submit"
          disabled={asking || !query.trim()}
          className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 active:scale-[0.98] disabled:opacity-60"
        >
          <span>{asking ? 'Analyzing...' : 'Ask AI'}</span>
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {prompts.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={asking}
            onClick={() => executeInlineAsk(item.question, item.topic)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-navy-800 transition-colors hover:border-brand-600 hover:bg-page active:scale-[0.98] disabled:opacity-60"
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3.5 space-y-3 border-t border-line pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-ink">{result.title}</h3>
              <p className="text-xs text-ink-muted-strong">&ldquo;{result.question}&rdquo;</p>
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="Close AI preview"
              className="rounded p-1 text-ink-muted-strong hover:bg-subtle hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="rounded-lg bg-page px-3.5 py-2.5 text-xs leading-relaxed text-ink">
            {result.answer}
          </div>

          {primaryChart && Array.isArray(primaryChart.items) && primaryChart.items.length > 0 && (
            <div className="rounded-lg bg-subtle p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                <span className="text-xs font-semibold text-ink">
                  {primaryChart.title}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {primaryChart.items.map((item) => {
                  const fill = BAR_FILL_STYLES[item.tone] || BAR_FILL_STYLES.primary;
                  const widthPct = Math.max(0, Math.min(100, Number(item.percent ?? 0)));
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-ink">{item.label}</span>
                        <span className="font-semibold text-navy-800 tabular-nums">
                          {item.display_value ?? item.value}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
                        <div
                          className={`h-full rounded-full ${fill}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {primarySection && (
            <div>
              {previewRows.length === 0 ? (
                <div className="flex items-center gap-1.5 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-muted-strong">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  <span>{primarySection.empty_message || 'No items require action.'}</span>
                </div>
              ) : primarySection.layout === 'steps' ? (
                <ol className="space-y-2">
                  {previewRows.map((row, idx) => (
                    <li
                      key={row.id || idx}
                      className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white p-2.5 text-xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">
                          {row.step || idx + 1}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-ink">{row.primary}</span>
                            {row.meta && (
                              <span className="rounded bg-page px-1.5 py-0.5 text-xs font-medium text-navy-800">
                                {row.meta}
                              </span>
                            )}
                          </div>
                          {row.secondary && (
                            <p className="mt-0.5 text-ink-muted-strong">{row.secondary}</p>
                          )}
                        </div>
                      </div>
                      {row.href && (
                        <Link
                          to={row.href}
                          className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-700 hover:underline"
                        >
                          <span>{row.action_label || 'Go'}</span>
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full min-w-[460px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-subtle text-ink-muted-strong">
                        <th scope="col" className="px-3 py-1.5 font-semibold">
                          Record
                        </th>
                        <th scope="col" className="px-3 py-1.5 font-semibold">
                          Details
                        </th>
                        <th scope="col" className="px-3 py-1.5 font-semibold">
                          Status
                        </th>
                        <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-white">
                      {previewRows.map((row) => {
                        const badgeStyle =
                          STATUS_BADGE_STYLES[row.status_tone] || STATUS_BADGE_STYLES.neutral;
                        return (
                          <tr key={row.id}>
                            <td className="px-3 py-2 font-medium text-ink">{row.primary}</td>
                            <td className="px-3 py-2 text-ink-muted-strong">{row.secondary}</td>
                            <td className="px-3 py-2">
                              {row.status && (
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeStyle}`}
                                >
                                  {row.status}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {row.href && (
                                <Link
                                  to={row.href}
                                  className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                                >
                                  <span>{row.action_label || 'Open'}</span>
                                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                </Link>
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
          )}

          <div className="flex justify-end">
            <Link
              to={`/dashboard/ask-ai?q=${encodeURIComponent(result.question)}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              <span>View full breakdown in Ask AI</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
