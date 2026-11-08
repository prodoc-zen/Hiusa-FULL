import { useId } from 'react';
import Button from './Button';

// Only a blocked step changes its look: red border, light red fill and title. The others are a plain row, because the
// sentence already says whether the viewer waits, acts or is done.
const TONES = {
  action: { box: 'border-line bg-white', title: 'text-ink' },
  waiting: { box: 'border-line bg-white', title: 'text-ink' },
  blocked: { box: 'border-danger/40 bg-danger-tint', title: 'text-danger-strong' },
  done: { box: 'border-line bg-white', title: 'text-ink' },
};

// The one row that says what happens next and who owns it. "waiting" never shows a button: the
// viewer has nothing to do. A disabled primary keeps its reason as visible text, not a tooltip.
export default function NextStep({ tone = 'action', title, body, actorRole, primary, className = '' }) {
  const reasonId = useId();
  const style = TONES[tone] ?? TONES.action;
  const showButton = tone !== 'waiting' && primary?.label;
  const disabled = Boolean(primary?.disabledReason);
  const role = tone === 'blocked' ? 'alert' : tone === 'waiting' || tone === 'done' ? 'status' : undefined;

  return (
    <div role={role} className={`flex flex-col gap-3 rounded-card border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${style.box} ${className}`}>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${style.title}`}>{title}</p>
        {body && <p className="mt-0.5 text-sm text-ink-muted-strong">{body}</p>}
        {actorRole && <p className="mt-1 text-xs text-ink-muted-strong">Owner: {actorRole}</p>}
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
          {disabled && <p id={reasonId} className="max-w-[40ch] text-xs text-ink-muted-strong sm:text-right">{primary.disabledReason}</p>}
        </div>
      )}
    </div>
  );
}
