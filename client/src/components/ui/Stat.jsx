import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Stat({ label, value, delta, deltaDirection = 'up', period, context, to, className = '' }) {
  const DeltaIcon = deltaDirection === 'down' ? ArrowDownRight : ArrowUpRight;
  const deltaTone = deltaDirection === 'down' ? 'text-danger-strong' : 'text-success-strong';

  const body = (
    <>
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-ink">{value}</p>
      {(delta || context) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          {delta && (
            <span className={`inline-flex items-center gap-0.5 ${deltaTone}`}>
              <DeltaIcon size={13} aria-hidden="true" />
              {delta}
            </span>
          )}
          {period && <span className="text-ink-soft">{period}</span>}
          {context && <span className="text-ink-muted">{context}</span>}
        </div>
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`block rounded-card border border-line bg-surface p-4 transition-colors duration-150 hover:bg-subtle ${className}`}>
        {body}
      </Link>
    );
  }

  return <div className={`rounded-card border border-line bg-surface p-4 ${className}`}>{body}</div>;
}
