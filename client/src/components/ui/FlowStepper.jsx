import { ArrowRight, Check, Circle, Minus, TriangleAlert } from 'lucide-react';

const STATE_WORD = {
  done: 'Done',
  current: 'Current step',
  blocked: 'Blocked',
  upcoming: 'Upcoming',
  skipped: 'Skipped',
};

const STATE_BADGE = {
  done: { icon: Check, className: 'bg-success text-white' },
  current: { icon: ArrowRight, className: 'bg-brand-700 text-white' },
  blocked: { icon: TriangleAlert, className: 'bg-danger text-white' },
  upcoming: { icon: Circle, className: 'border border-line bg-surface text-ink-soft' },
  skipped: { icon: Minus, className: 'border border-line bg-subtle text-ink-muted-strong' },
};

const LABEL_TONE = {
  done: 'text-ink',
  current: 'font-bold text-ink',
  blocked: 'font-bold text-danger-strong',
  upcoming: 'text-ink-muted-strong',
  skipped: 'text-ink-muted-strong',
};

function normalize(state) {
  return STATE_WORD[state] ? state : 'upcoming';
}

function StateIcon({ state, size = 24 }) {
  const { icon: Icon, className } = STATE_BADGE[state];
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full ${className}`} style={{ width: size, height: size }}>
      <Icon size={size === 24 ? 14 : 12} strokeWidth={state === 'upcoming' ? 2 : 2.5} />
    </span>
  );
}

function FullStepper({ steps, ariaLabel, className }) {
  return (
    <ol aria-label={ariaLabel} className={`flex flex-col gap-4 md:flex-row md:gap-2 ${className}`}>
      {steps.map((step, index) => {
        const state = normalize(step.state);
        return (
          <li
            key={step.key}
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex min-w-0 gap-3 md:flex-1 md:flex-col md:gap-2"
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[11px] top-7 -bottom-4 w-px md:-right-2 md:bottom-auto md:left-8 md:top-[11px] md:h-px md:w-auto ${state === 'done' ? 'bg-success' : 'bg-line'}`}
              />
            )}
            <StateIcon state={state} />
            <div className="min-w-0 text-sm">
              <p className={LABEL_TONE[state]}>
                <span className="sr-only">{STATE_WORD[state]}: </span>
                {step.label}
              </p>
              {step.actor && <p className="text-xs font-medium text-ink-muted-strong">{step.actor}</p>}
              {step.note && <p className="text-xs font-semibold text-ink-muted-strong">{step.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CompactStepper({ steps, ariaLabel, summary, className }) {
  const counted = steps.filter((step) => normalize(step.state) !== 'skipped');
  const total = counted.length;
  const done = counted.filter((step) => normalize(step.state) === 'done').length;
  const focusIndex = counted.findIndex((step) => ['current', 'blocked'].includes(normalize(step.state)));
  const focus = focusIndex >= 0 ? counted[focusIndex] : null;
  const state = focus ? normalize(focus.state) : done === total && total > 0 ? 'done' : 'upcoming';
  const text = focus
    ? `Step ${focusIndex + 1} of ${total}: ${focus.label}`
    : done === total && total > 0 ? `Complete: ${done} of ${total} steps done` : `${done} of ${total} steps done`;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const meterTone = state === 'blocked' ? 'bg-danger' : state === 'done' ? 'bg-success' : 'bg-brand-600';

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink">
        <StateIcon state={state} size={16} />
        <span className="sr-only">{STATE_WORD[state]}: </span>
        {summary ? (
          <>
            <span className="truncate sm:hidden">{summary}</span>
            <span className="hidden truncate sm:inline">{text}</span>
          </>
        ) : (
          <span className="truncate">{text}</span>
        )}
      </p>
      <div
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={text}
        className={`h-1 w-full overflow-hidden rounded-full bg-line-soft ${summary ? 'max-sm:hidden' : ''}`}
      >
        <div className={`h-full rounded-full ${meterTone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// variant="compact" is one line for table rows. Pass `summary` (the next action text) to show it
// alone below 640px, where a row has no room for a step label and a meter.
export default function FlowStepper({ steps = [], variant = 'full', ariaLabel = 'Progress', summary, className = '' }) {
  if (steps.length === 0) return null;
  if (variant === 'compact') {
    return <CompactStepper steps={steps} ariaLabel={ariaLabel} summary={summary} className={className} />;
  }
  return <FullStepper steps={steps} ariaLabel={ariaLabel} className={className} />;
}
