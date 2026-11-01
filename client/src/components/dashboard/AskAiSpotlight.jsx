import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, Sparkles } from 'lucide-react';

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
  ],
};

export default function AskAiSpotlight({ role = 'STUDENT' }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const prompts = PROMPTS_BY_ROLE[role] || PROMPTS_BY_ROLE.STUDENT;

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      navigate('/dashboard/ask-ai');
      return;
    }
    navigate(`/dashboard/ask-ai?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <section
      aria-label="Ask AI assistant"
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
              Check what needs action today, who hasn&apos;t submitted requirements, or inspect live queues.
            </p>
          </div>
        </div>
        <Link
          to="/dashboard/ask-ai"
          className="inline-flex items-center gap-1 rounded-lg bg-[#EEF6FB] px-2.5 py-1.5 text-xs font-medium text-[#0F2F62] transition-colors hover:bg-[#DDEEF9]"
        >
          <span>Open Ask AI</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
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
          placeholder="Ask e.g. What should I do today? or Who hasn't submitted requirements?"
          className="min-h-[38px] flex-1 rounded-lg border border-[#DDE7EF] bg-[#F8FAFC] px-3 py-1.5 text-base text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0B8ED0] focus:bg-white focus:outline-none sm:text-xs"
        />
        <button
          type="submit"
          className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0B8ED0] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0978B2] active:scale-[0.98]"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Ask AI</span>
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {prompts.map((item) => (
          <Link
            key={item.label}
            to={`/dashboard/ask-ai?q=${encodeURIComponent(item.question)}&topic=${encodeURIComponent(item.topic)}`}
            className="inline-flex items-center gap-1 rounded-full border border-[#DDE7EF] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-medium text-[#0F2F62] transition-colors hover:border-[#0B8ED0] hover:bg-[#EEF6FB]"
          >
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

