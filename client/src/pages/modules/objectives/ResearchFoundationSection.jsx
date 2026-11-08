import Card from '../../../components/ui/Card';
import StatusBadge from '../../../components/ui/StatusBadge';
import ObjectiveDetails from './ObjectiveDetails';
import { presentStatus } from './objectivesFormat';

function FoundationObjective({ objective }) {
  if (!objective) return null;

  const { tone, label } = presentStatus(objective.status);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-semibold text-ink">
          {objective.code}: {objective.title}
        </h3>
        <StatusBadge status={objective.status} tone={tone} label={label} />
      </div>
      <div className="mt-3">
        <ObjectiveDetails objective={objective} />
      </div>
    </div>
  );
}

export default function ResearchFoundationSection({ so1, so4 }) {
  if (!so1 && !so4) return null;

  return (
    <Card title="Research foundation">
      <div className="grid gap-6 divide-y divide-line-soft sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:gap-0">
        <div className="sm:pr-6">{so1 && <FoundationObjective objective={so1} />}</div>
        <div className="pt-6 sm:pl-6 sm:pt-0">{so4 && <FoundationObjective objective={so4} />}</div>
      </div>
    </Card>
  );
}
