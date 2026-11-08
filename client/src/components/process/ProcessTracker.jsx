import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronDown, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getProcessStatus } from '../../services/processService';
import { useRefetchOnReturn } from '../../hooks/useRefetchOnReturn';
import { Button, FlowStepper, NextStep, SkeletonCard } from '../ui';

const FLOW_STATE = { done: 'done', current: 'current', todo: 'upcoming' };

const STATE_WORD = { done: 'Done', current: 'Current step', upcoming: 'Upcoming' };

const STEP_ICON = {
  done: { icon: Check, className: 'bg-success text-white' },
  current: { icon: ArrowRight, className: 'bg-brand-700 text-white' },
  upcoming: { icon: Circle, className: 'border border-line bg-surface text-ink-soft' },
};

function countNote(step) {
  if (step.note) return step.note;
  if (step.total > 0 && step.count != null) return `${step.count} of ${step.total}`;
  if (step.count > 0) return String(step.count);
  return undefined;
}

function toFlowSteps(steps) {
  return steps.map((step) => ({ key: step.key, label: step.label, state: FLOW_STATE[step.state] ?? 'upcoming', note: countNote(step) }));
}

// One short row of steps. A step already visited links to where it was done when the server sends
// that place as `action.path`; the step still to do links nowhere, because its one action sits in NextAction.
function Steps({ steps, ariaLabel }) {
  return (
    <ol aria-label={ariaLabel} className="flex flex-col gap-2 md:flex-row md:flex-wrap md:gap-x-6">
      {steps.map((step) => {
        const state = FLOW_STATE[step.state] ?? 'upcoming';
        const { icon: Icon, className } = STEP_ICON[state];
        // A written note on the current step is said once, in the next-step row below.
        const note = state === 'current' && step.note ? undefined : countNote(step);
        const label = (
          <>
            <span className="sr-only">{STATE_WORD[state]}: </span>
            {step.label}
          </>
        );
        return (
          <li key={step.key} aria-current={state === 'current' ? 'step' : undefined} className="flex min-w-0 items-center gap-2 text-sm">
            <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${className}`}><Icon size={12} strokeWidth={state === 'upcoming' ? 2 : 2.5} /></span>
            {state === 'done' && step.action?.path
              ? <Link to={step.action.path} className="inline-flex min-h-11 items-center text-ink underline underline-offset-2 hover:text-brand-700 md:min-h-0">{label}</Link>
              : <span className={state === 'current' ? 'font-semibold text-ink' : state === 'done' ? 'text-ink' : 'text-ink-muted-strong'}>{label}</span>}
            {note && <span className="text-xs text-ink-muted-strong">{note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// One row that says who acts next: a secondary button when this person can act, plain text when someone
// else holds the current step. The tracker sits above each home page's own main action (the setup checklist
// or the page's header button), so its button never fills and the screen keeps one filled button.
function NextAction({ steps, className = '' }) {
  const current = steps.find((step) => step.state === 'current');
  if (!current) return null;
  if (!current.action) {
    return <NextStep tone="waiting" title={`Waiting on: ${current.label}`} body={current.note} className={className} />;
  }
  return (
    <div className={`flex flex-col gap-3 rounded-card border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{`Next for you: ${current.label}`}</p>
        {current.note && <p className="mt-0.5 text-sm text-ink-muted-strong">{current.note}</p>}
      </div>
      <Button variant="secondary" to={current.action.path} className="shrink-0">{current.action.label}</Button>
    </div>
  );
}

function CollegeRows({ colleges }) {
  return (
    <ul className="mt-3 divide-y divide-line-soft border-y border-line">
      {colleges.map((college) => {
        const current = college.steps.find((step) => step.state === 'current');
        return (
          <li key={college.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0 sm:w-1/2">
              <p className="truncate text-sm font-medium text-ink">{college.name}</p>
              <FlowStepper variant="compact" steps={toFlowSteps(college.steps)} ariaLabel={`${college.name} setup progress`} className="mt-1.5" />
            </div>
            {current?.action && <Button variant="ghost" size="sm" to={current.action.path} className="shrink-0 self-start sm:self-auto">{current.action.label}</Button>}
          </li>
        );
      })}
    </ul>
  );
}

function CollegeList({ colleges }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const finished = colleges.filter((college) => college.complete).length;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-brand-700 transition-colors duration-150 hover:bg-subtle"
      >
        {open ? 'Hide colleges' : 'Show each college'}
        <span className="font-normal text-ink-muted-strong">{finished} of {colleges.length} finished</span>
        <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={listId} hidden={!open}>{open && <CollegeRows colleges={colleges} />}</div>
    </div>
  );
}

export default function ProcessTracker({ className = '' }) {
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const epoch = useRef(0);

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      epoch.current += 1;
      setState((current) => ({ ...current, loading: true, error: false }));
    }
    const mine = epoch.current;
    return getProcessStatus()
      .then((response) => {
        if (mine !== epoch.current) return;
        setState((current) => (silent && JSON.stringify(current.data) === JSON.stringify(response.data) ? current : { loading: false, error: false, data: response.data }));
      })
      .catch(() => {
        if (!silent && mine === epoch.current) setState({ loading: false, error: true, data: null });
      });
  }, []);

  useEffect(() => {
    load();
    return () => { epoch.current += 1; };
  }, [load]);
  useRefetchOnReturn(() => load({ silent: true }));

  const { loading, error, data } = state;

  if (loading && !data) return <SkeletonCard className={className} />;
  if (error) {
    return (
      <div role="alert" className={`flex flex-col gap-3 rounded-card border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
        <p className="text-sm font-medium text-ink">Your place in the process could not load.</p>
        <Button variant="secondary" onClick={() => load()}>Try again</Button>
      </div>
    );
  }
  if (!data || !data.steps?.length) return null;
  if (data.complete) {
    return (
      <p role="status" className={`flex items-center gap-2 text-sm text-ink-muted-strong ${className}`}>
        <CheckCircle2 size={16} aria-hidden="true" className="text-success-strong" />
        Setup complete
      </p>
    );
  }

  const position = data.steps.findIndex((step) => step.state === 'current') + 1;
  return (
    <section aria-label="Where you are in the process" className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-ink">{data.title}</h2>
        {position > 0 && <p className="text-xs text-ink-muted-strong">Step {position} of {data.steps.length}</p>}
      </div>
      <Steps steps={data.steps} ariaLabel={data.title} />
      <NextAction steps={data.steps} />
      {data.colleges?.length > 0 && <CollegeList colleges={data.colleges} />}
    </section>
  );
}
