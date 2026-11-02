import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Bot, CheckCircle2, Sparkles, X } from 'lucide-react';
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
  danger: 'bg-[#DC2626]',
  warning: 'bg-[#D97706]',
  success: 'bg-[#16A34A]',
  info: 'bg-[#0B8ED0]',
  primary: 'bg-[#0F2F62]',
  neutral: 'bg-[#64748B]',
};

const STATUS_BADGE_STYLES = {
  danger: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
  warning: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
  success: 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]',
  info: 'bg-[#E0F2FE] text-[#0284C7] border-[#BAE6FD]',
  neutral: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
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
      data-tour="ask-ai-spotlight"
      className="rounded-xl border border-[#DDE7EF] bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#0F172A]">Ask AI Assistant</h2>
            <p className="text-xs text-[#475569]">
              Check what needs action today, who hasn&apos;t submitted requirements, or view formatted graphs and rows.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('hiusa-open-onboarding-tour'))}
            className="inline-flex items-center gap-1 rounded-lg border border-[#DDE7EF] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0F2F62] transition-colors hover:border-[#0B8ED0] hover:bg-[#F8FBFD]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#0878B7]" aria-hidden="true" />
            <span>Interactive Role Tour</span>
          </button>
          <Link
            to="/dashboard/ask-ai"
            className="inline-flex items-center gap-1 rounded-lg bg-[#EEF6FB] px-2.5 py-1.5 text-xs font-medium text-[#0F2F62] transition-colors hover:bg-[#DDEEF9]"
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
          className="min-h-[38px] flex-1 rounded-lg border border-[#DDE7EF] bg-[#F8FAFC] px-3 py-1.5 text-base text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0B8ED0] focus:bg-white focus:outline-none sm:text-xs"
        />
        <button
          type="submit"
          disabled={asking || !query.trim()}
          className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0B8ED0] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0978B2] active:scale-[0.98] disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
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
            className="inline-flex items-center gap-1 rounded-full border border-[#DDE7EF] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-medium text-[#0F2F62] transition-colors hover:border-[#0B8ED0] hover:bg-[#EEF6FB] active:scale-[0.98] disabled:opacity-60"
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2.5 text-xs font-medium text-[#DC2626]">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3.5 space-y-3 border-t border-[#DDE7EF] pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-[#0F172A]">{result.title}</h3>
              <p className="text-[11px] text-[#475569]">&ldquo;{result.question}&rdquo;</p>
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="Close AI preview"
              className="rounded p-1 text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="rounded-lg bg-[#EEF6FB] px-3.5 py-2.5 text-xs leading-relaxed text-[#0F172A]">
            {result.answer}
          </div>

          {primaryChart && Array.isArray(primaryChart.items) && primaryChart.items.length > 0 && (
            <div className="rounded-lg bg-[#F8FAFC] p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-[#0B8ED0]" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-[#0F172A]">
                  {primaryChart.title}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {primaryChart.items.map((item) => {
                  const fill = BAR_FILL_STYLES[item.tone] || BAR_FILL_STYLES.primary;
                  const widthPct = Math.max(0, Math.min(100, Number(item.percent ?? 0)));
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-[#0F172A]">{item.label}</span>
                        <span className="font-semibold text-[#0F2F62] tabular-nums">
                          {item.display_value ?? item.value}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
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
                <div className="flex items-center gap-1.5 rounded-lg bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" aria-hidden="true" />
                  <span>{primarySection.empty_message || 'No items require action.'}</span>
                </div>
              ) : primarySection.layout === 'steps' ? (
                <ol className="space-y-2">
                  {previewRows.map((row, idx) => (
                    <li
                      key={row.id || idx}
                      className="flex items-start justify-between gap-3 rounded-lg border border-[#DDE7EF] bg-white p-2.5 text-xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0F2F62] text-[10px] font-bold text-white">
                          {row.step || idx + 1}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-[#0F172A]">{row.primary}</span>
                            {row.meta && (
                              <span className="rounded bg-[#EEF6FB] px-1.5 py-0.5 text-[10px] font-medium text-[#0F2F62]">
                                {row.meta}
                              </span>
                            )}
                          </div>
                          {row.secondary && (
                            <p className="mt-0.5 text-[#475569]">{row.secondary}</p>
                          )}
                        </div>
                      </div>
                      {row.href && (
                        <Link
                          to={row.href}
                          className="inline-flex shrink-0 items-center gap-1 font-medium text-[#0878B7] hover:underline"
                        >
                          <span>{row.action_label || 'Go'}</span>
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#DDE7EF]">
                  <table className="w-full min-w-[460px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#DDE7EF] bg-[#F8FAFC] text-[#475569]">
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
                    <tbody className="divide-y divide-[#DDE7EF] bg-white">
                      {previewRows.map((row) => {
                        const badgeStyle =
                          STATUS_BADGE_STYLES[row.status_tone] || STATUS_BADGE_STYLES.neutral;
                        return (
                          <tr key={row.id}>
                            <td className="px-3 py-2 font-medium text-[#0F172A]">{row.primary}</td>
                            <td className="px-3 py-2 text-[#475569]">{row.secondary}</td>
                            <td className="px-3 py-2">
                              {row.status && (
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeStyle}`}
                                >
                                  {row.status}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {row.href && (
                                <Link
                                  to={row.href}
                                  className="inline-flex items-center gap-1 font-medium text-[#0878B7] hover:underline"
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
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0878B7] hover:underline"
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
