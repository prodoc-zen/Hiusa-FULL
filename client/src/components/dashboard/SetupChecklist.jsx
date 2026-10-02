import { useState } from 'react';
import { CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import ProgressMeter from '../ui/ProgressMeter';

function storageKey(userKey) {
  return `hiusa.setup.hidden.${userKey}`;
}

function readHidden(userKey) {
  try { return localStorage.getItem(storageKey(userKey)) === '1'; } catch { return false; }
}

function StepRow({ step }) {
  const icon = step.done
    ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success-strong" aria-hidden="true" />
    : <Circle size={18} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />;
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${step.done ? 'text-ink-muted' : 'text-ink'}`}>
          {step.label}
          {step.done && <span className="sr-only"> (done)</span>}
        </span>
        {!step.done && <span className="mt-0.5 block text-xs font-medium leading-5 text-ink-muted">{step.detail}</span>}
      </span>
      {step.href && <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />}
    </>
  );

  return (
    <li>
      {step.href ? (
        <Link to={step.href} className="-mx-2 flex items-start gap-3 rounded-control px-2 py-2.5 transition-colors duration-150 hover:bg-subtle">{body}</Link>
      ) : (
        <div className="flex items-start gap-3 py-2.5">{body}</div>
      )}
    </li>
  );
}

/**
 * First-run guidance from the briefing's `setup` block. Each step is checked
 * off by the server from real records; hiding the list is a per-person choice.
 */
export default function SetupChecklist({ setup, userKey }) {
  const [hidden, setHidden] = useState(() => readHidden(userKey));

  if (!setup || setup.completed >= setup.total || hidden) return null;

  function hide() {
    try { localStorage.setItem(storageKey(userKey), '1'); } catch { /* the list just reappears next visit */ }
    setHidden(true);
  }

  return (
    <section aria-labelledby="setup-checklist-title" className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="setup-checklist-title" className="text-base font-bold text-ink">Getting started</h2>
          <p className="mt-0.5 text-xs font-medium text-ink-muted">Each step checks itself off once the work is done anywhere in HIUSA.</p>
        </div>
        <button type="button" onClick={hide} className="rounded-control px-2 py-1 text-xs font-semibold text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink">
          Hide checklist
        </button>
      </div>
      <ProgressMeter className="mt-4" kind="progress" label="Progress" value={setup.completed} max={setup.total} valueLabel={`${setup.completed} of ${setup.total} done`} />
      <ul className="mt-3 divide-y divide-line-soft">
        {setup.steps.map((step) => <StepRow key={step.key} step={step} />)}
      </ul>
    </section>
  );
}
