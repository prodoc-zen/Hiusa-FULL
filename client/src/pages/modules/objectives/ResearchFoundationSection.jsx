import { BadgeCheck, ClipboardList } from 'lucide-react';
import Card from '../../../components/ui/Card';
import StatusBadge from '../../../components/ui/StatusBadge';
import ObjectiveDetails from './ObjectiveDetails';
import { presentStatus } from './objectivesFormat';

const ICONS = { SO1: ClipboardList, SO4: BadgeCheck };

function FoundationObjective({ objective }) {
  if (!objective) return null;

  const { tone, label } = presentStatus(objective.status);
  const Icon = ICONS[objective.code];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
              <Icon size={20} aria-hidden="true" />
            </span>
          )}
          <h3 className="min-w-0 text-base font-bold text-ink">
            {objective.code}: {objective.title}
          </h3>
        </div>
        <StatusBadge status={objective.status} tone={tone} label={label} />
      </div>
      <div className="mt-3 sm:pl-[52px]">
        <ObjectiveDetails objective={objective} fallbackLabel="the evaluation module" />
      </div>
    </div>
  );
}

export default function ResearchFoundationSection({ so1, so4 }) {
  if (!so1 && !so4) return null;

  return (
    <Card
      title="Research foundation"
      description="Assessing current SBO practice and evaluating this system's acceptability both live in the Evaluation module."
    >
      <div className="grid gap-6 divide-y divide-line-soft sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:gap-0">
        <div className="sm:pr-6">{so1 && <FoundationObjective objective={so1} />}</div>
        <div className="pt-6 sm:pl-6 sm:pt-0">{so4 && <FoundationObjective objective={so4} />}</div>
      </div>
    </Card>
  );
}
