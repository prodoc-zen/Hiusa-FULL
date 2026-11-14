import { useId, useState } from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import Button from '../ui/Button';
import ProgressMeter from '../ui/ProgressMeter';

const VISIBLE_STEPS = 3;

function DoneRow({ step, className = '' }) {
  return (
    <li className={`flex items-center gap-3 py-2.5 ${className}`}>
      <CheckCircle2 size={18} className="shrink-0 text-success-strong" aria-hidden="true" />
      <span className="text-sm font-medium text-ink-muted">
        {step.label}
        <span className="sr-only"> (done)</span>
      </span>
    </li>
  );
}

function OpenRow({ step, primary, className = '' }) {
  const [showWhere, setShowWhere] = useState(false);
  const whereId = useId();
  const waiting = !step.href && !step.inPerson;
  const Icon = step.blocked || waiting ? Clock : Circle;
  const action = step.action || 'Open';

  return (
    <li className={`py-3 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon size={18} className={`mt-0.5 shrink-0 ${step.blocked ? 'text-warning-strong' : 'text-ink-soft'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{step.label}</p>
            {step.blocked ? (
              <p className="mt-0.5 text-xs font-medium leading-5 text-warning-strong">
                <span className="sr-only">Blocked. </span>{step.note}
              </p>
            ) : (
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{step.detail}</p>
            )}
          </div>
        </div>
        {!step.blocked && step.href && (
          <Button to={step.href} variant={primary ? 'primary' : 'secondary'} className="shrink-0">{action}</Button>
        )}
        {!step.blocked && step.inPerson && (
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => setShowWhere((value) => !value)}
            aria-expanded={showWhere}
            aria-controls={whereId}
          >
            Where to go
          </Button>
        )}
      </div>
      {step.inPerson && showWhere && (
        <p id={whereId} className="mt-2 pl-[1.875rem] text-xs leading-5 text-ink-muted-strong">
          This step is done in person at the officers' desk, not online. It turns done once your fingerprint is enrolled.
        </p>
      )}
    </li>
  );
}

/**
 * First-run guidance from the briefing's `setup` block. Each server step is checked off from real
 * records; the parent owns hiding the list (a per-person choice). Only the next three open steps show, the rest
 * (and the finished ones) sit behind "Show all". A step carries `action` (its button label),
 * `inPerson` (no link, explained on demand) or `advisory` (a link with no done state, left out of
 * the progress count).
 */
export default function SetupChecklist({ setup, title = 'Getting started', description, primaryFirst = true, onHide }) {
  const [expanded, setExpanded] = useState(false);

  if (!setup || setup.completed >= setup.total) return null;

  const steps = setup.steps;
  const open = steps.filter((step) => !step.done);
  const shown = expanded ? steps : open.slice(0, VISIBLE_STEPS);
  // On a phone only the first open step shows until the person taps; the rest of the shown steps stay on wider screens.
  const phoneHides = !expanded && shown.length > 1;
  const canToggle = steps.length > shown.length || expanded;
  const primaryKey = primaryFirst ? open.find((step) => step.href || step.inPerson)?.key : null;

  return (
    <section aria-labelledby="setup-checklist-title" className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="setup-checklist-title" className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted max-sm:hidden">{description}</p>}
        </div>
        <button type="button" onClick={onHide} className="min-h-11 rounded-control px-2 py-1 text-xs font-semibold text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink">
          Hide checklist
        </button>
      </div>
      <ProgressMeter className="mt-4" kind="progress" label="Progress" value={setup.completed} max={setup.total} valueLabel={`${setup.completed} of ${setup.total} done`} />
      <ol className="mt-3 divide-y divide-line-soft">
        {shown.map((step, index) => {
          const phoneHidden = phoneHides && index > 0 ? 'max-sm:hidden' : '';
          return step.done
            ? <DoneRow key={step.key} step={step} className={phoneHidden} />
            : <OpenRow key={step.key} step={step} primary={step.key === primaryKey} className={phoneHidden} />;
        })}
      </ol>
      {(canToggle || phoneHides) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`mt-2 min-h-11 rounded-control px-2 text-sm font-semibold text-brand-700 hover:bg-subtle ${canToggle ? '' : 'sm:hidden'}`}
        >
          {expanded ? 'Show fewer' : 'Show all steps'}
        </button>
      )}
    </section>
  );
}
