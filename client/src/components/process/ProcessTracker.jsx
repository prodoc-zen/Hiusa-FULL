import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { getProcessStatus } from '../../services/processService';
import { useRefetchOnReturn } from '../../hooks/useRefetchOnReturn';
import { Button, FlowStepper, SkeletonCard } from '../ui';

const FLOW_STATE = { done: 'done', current: 'current', todo: 'upcoming' };

function countNote(step) {
  if (step.note) return step.note;
  if (step.total > 0 && step.count != null) return `${step.count} of ${step.total}`;
  if (step.count > 0) return String(step.count);
  return undefined;
}

function toFlowSteps(steps) {
  return steps.map((step) => ({ key: step.key, label: step.label, state: FLOW_STATE[step.state] ?? 'upcoming', note: countNote(step) }));
}

function NextAction({ steps }) {
  const current = steps.find((step) => step.state === 'current');
  if (!current) return null;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line-soft pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm font-semibold text-ink">
        <span className="text-ink-muted-strong">{current.action ? 'Next: ' : 'Waiting on: '}</span>{current.label}
      </p>
      {current.action && <Button variant="secondary" to={current.action.path} className="shrink-0">{current.action.label}</Button>}
    </div>
  );
}

function CollegeRows({ colleges }) {
  return (
    <ul className="mt-3 divide-y divide-line-soft rounded-control border border-line">
      {colleges.map((college) => {
        const current = college.steps.find((step) => step.state === 'current');
        return (
          <li key={college.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0 sm:w-1/2">
              <p className="truncate text-sm font-bold text-ink">{college.name}</p>
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
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-bold text-brand-700 transition-colors duration-150 hover:bg-subtle"
      >
        {open ? 'Hide colleges' : 'Show each college'}
        <span className="font-semibold text-ink-muted-strong">{finished} of {colleges.length} finished</span>
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
      <div role="alert" className={`flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between ${className}`}>
        <p className="text-sm font-semibold text-ink">Your place in the process could not load.</p>
        <Button variant="secondary" onClick={() => load()}>Try again</Button>
      </div>
    );
  }
  if (!data || !data.steps?.length) return null;
  if (data.complete) {
    return (
      <p role="status" className={`flex items-center gap-2 text-sm font-semibold text-ink-muted-strong ${className}`}>
        <CheckCircle2 size={16} aria-hidden="true" className="text-success-strong" />
        Setup complete
      </p>
    );
  }

  const position = data.steps.findIndex((step) => step.state === 'current') + 1;
  return (
    <section aria-label="Where you are in the process" className={`rounded-card border border-line bg-surface p-4 shadow-card sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-bold text-ink">{data.title}</h2>
        {position > 0 && <p className="text-xs font-semibold text-ink-muted-strong">Step {position} of {data.steps.length}</p>}
      </div>
      <FlowStepper steps={toFlowSteps(data.steps)} ariaLabel={data.title} className="mt-4" />
      <NextAction steps={data.steps} />
      {data.colleges?.length > 0 && <CollegeList colleges={data.colleges} />}
    </section>
  );
}
