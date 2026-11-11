import { ArrowRight } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Tooltip from '../../../components/ui/Tooltip';
import { manilaDate, relativeTime } from '../../../lib/format';
import ObjectiveEvidenceList from './ObjectiveEvidenceList';

function LastActivity({ value }) {
  if (!value) {
    return <p className="mt-3 text-xs text-ink-muted">No activity recorded yet.</p>;
  }

  return (
    <p className="mt-3 text-xs text-ink-muted">
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
  statementClassName = 'max-w-[75ch] text-sm leading-6 text-ink-muted',
}) {
  const { statement, mechanism, status, evidence = [], last_activity_at: lastActivityAt } = objective;
  const firstLinked = evidence.find((item) => item.href);

  return (
    <div>
      <p className={statementClassName}>{statement}</p>
      <p className="mt-2 max-w-[75ch] text-xs text-ink-muted-strong">
        <span className="text-ink-muted">Mechanism: </span>
        {mechanism}
      </p>

      <ObjectiveEvidenceList items={evidence} />

      {status === 'no_data' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="max-w-[55ch] text-sm text-ink-muted">
            {evidence.length === 0
              ? 'No activity yet. This objective is assessed outside the application, so there are no records to show.'
              : 'No activity yet. This scope has not produced any real records for this objective.'}
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
