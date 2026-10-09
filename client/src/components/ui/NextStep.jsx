import { useId } from 'react';
import { ArrowRight, CircleCheck, Clock, TriangleAlert } from 'lucide-react';
import Button from './Button';

const TONES = {
  action: { icon: ArrowRight, box: 'border-brand-100 bg-brand-50', iconClass: 'text-brand-700' },
  waiting: { icon: Clock, box: 'border-warning/40 bg-warning-tint', iconClass: 'text-warning-strong' },
  blocked: { icon: TriangleAlert, box: 'border-danger/30 bg-danger-tint', iconClass: 'text-danger-strong' },
  done: { icon: CircleCheck, box: 'border-success/30 bg-success-tint', iconClass: 'text-success-strong' },
};

// The one callout that says what happens next and who owns it. "waiting" never shows a button: the
// viewer has nothing to do. A disabled primary keeps its reason as visible text, not a tooltip.
export default function NextStep({ tone = 'action', title, body, actorRole, primary, className = '' }) {
  const reasonId = useId();
  const style = TONES[tone] ?? TONES.action;
  const Icon = style.icon;
  const showButton = tone !== 'waiting' && primary?.label;
  const disabled = Boolean(primary?.disabledReason);
  const role = tone === 'waiting' || tone === 'done' ? 'status' : undefined;

  return (
    <div role={role} className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${style.box} ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon size={20} aria-hidden="true" className={`mt-0.5 shrink-0 ${style.iconClass}`} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{title}</p>
          {body && <p className="mt-0.5 text-sm font-medium text-ink-muted-strong">{body}</p>}
          {actorRole && <p className="mt-1 text-xs font-semibold text-ink-muted-strong">Owner: {actorRole}</p>}
        </div>
      </div>
      {showButton && (
        <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
          <Button
            variant={tone === 'done' ? 'secondary' : 'primary'}
            to={primary.to}
            onClick={primary.onClick}
            disabled={disabled}
            aria-describedby={disabled ? reasonId : undefined}
          >
            {primary.label}
          </Button>
          {disabled && <p id={reasonId} className="max-w-[40ch] text-xs font-semibold text-ink-muted-strong sm:text-right">{primary.disabledReason}</p>}
        </div>
      )}
    </div>
  );
}
