import Card from '../../../components/ui/Card';
import StatusBadge from '../../../components/ui/StatusBadge';
import ObjectiveDetails from './ObjectiveDetails';
import { presentStatus } from './objectivesFormat';
import { PILLARS } from '../../../lib/pillars';

function PillarRow({ objective }) {
  const pillar = PILLARS.find((candidate) => candidate.objectiveCode === objective.code);
  const { tone, label } = presentStatus(objective.status);

  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-semibold text-ink">
          {objective.code}: {pillar?.label || objective.title}
        </h3>
        <StatusBadge status={objective.status} tone={tone} label={label} />
      </div>
      <div className="mt-3">
        <ObjectiveDetails objective={objective} fallbackLabel={pillar?.label || 'this feature'} />
      </div>
    </div>
  );
}

export default function So2PillarSystem({ objectives }) {
  if (!objectives || objectives.length === 0) return null;

  return (
    <Card
      title="SO2: one system, six areas"
    >
      <div className="divide-y divide-line-soft">
        {objectives.map((objective) => <PillarRow key={objective.code} objective={objective} />)}
      </div>
    </Card>
  );
}
