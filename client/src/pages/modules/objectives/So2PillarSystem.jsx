import Card from '../../../components/ui/Card';
import StatusBadge from '../../../components/ui/StatusBadge';
import ObjectiveDetails from './ObjectiveDetails';
import { presentStatus } from './objectivesFormat';
import { PILLARS } from '../../../lib/pillars';

function PillarRow({ objective }) {
  const pillar = PILLARS.find((candidate) => candidate.objectiveCode === objective.code);
  const Icon = pillar?.icon;
  const { tone, label } = presentStatus(objective.status);

  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
              <Icon size={20} aria-hidden="true" />
            </span>
          )}
          <h3 className="min-w-0 text-base font-bold text-ink">
            {objective.code}: {pillar?.label || objective.title}
          </h3>
        </div>
        <StatusBadge status={objective.status} tone={tone} label={label} />
      </div>
      <div className="mt-3 sm:pl-[52px]">
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
      description="The mechanisms the paper names for financial management, events, tasks, elections, merchandise, and communication, working together as one platform."
    >
      <div className="divide-y divide-line-soft">
        {objectives.map((objective) => <PillarRow key={objective.code} objective={objective} />)}
      </div>
    </Card>
  );
}
