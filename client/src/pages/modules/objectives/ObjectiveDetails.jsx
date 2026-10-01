import { ArrowRight } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Tooltip from '../../../components/ui/Tooltip';
import { manilaDate, relativeTime } from '../../../lib/format';
import ObjectiveEvidenceList from './ObjectiveEvidenceList';

function LastActivity({ value }) {
  if (!value) {
    return <p className="mt-3 text-xs font-semibold text-ink-soft">No activity recorded yet.</p>;
  }

  return (
    <p className="mt-3 text-xs font-semibold text-ink-soft">
      Last activity{' '}
      <Tooltip content={manilaDate(value, 'weekday')}>
        <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
          {relativeTime(value)}
        </span>
      </Tooltip>
    </p>
  );
}

export default function ObjectiveDetails({
  objective,
  fallbackLabel = 'this feature',
  statementClassName = 'max-w-[75ch] text-sm font-medium leading-6 text-ink-muted',
}) {
  const { statement, mechanism, status, evidence = [], last_activity_at: lastActivityAt } = objective;
  const firstLinked = evidence.find((item) => item.href);

  return (
    <div>
      <p className={statementClassName}>{statement}</p>
      <p className="mt-2 max-w-[75ch] text-xs font-semibold text-ink-muted-strong">
        <span className="text-ink-soft">Mechanism: </span>
        {mechanism}
      </p>

      <ObjectiveEvidenceList items={evidence} />

      {status === 'no_data' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-control border border-dashed border-line bg-subtle px-4 py-3">
          <p className="max-w-[55ch] text-sm font-medium text-ink-muted">
            No activity yet. {mechanism} has not produced any real records in this scope.
          </p>
          {firstLinked && (
            <Button to={firstLinked.href} variant="secondary" size="sm" rightIcon={ArrowRight}>
              Open {fallbackLabel}
            </Button>
          )}
        </div>
      )}

      <LastActivity value={lastActivityAt} />
    </div>
  );
}
