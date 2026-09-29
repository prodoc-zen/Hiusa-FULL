import Card from '../../../components/ui/Card';
import StatusBadge from '../../../components/ui/StatusBadge';
import ObjectiveDetails from './ObjectiveDetails';
import { presentStatus } from './objectivesFormat';

export default function GeneralObjectiveBanner({ objective }) {
  if (!objective) return null;

  const { tone, label } = presentStatus(objective.status);

  return (
    <Card
      className="border-brand-100 bg-brand-50"
      title={`${objective.code} — ${objective.title}`}
      description="The study's general objective frames every area below: one centralized, AI-assisted platform for student body organizations."
      actions={<StatusBadge status={objective.status} tone={tone} label={label} />}
    >
      <ObjectiveDetails
        objective={objective}
        fallbackLabel="a guided run-through"
        statementClassName="max-w-[75ch] text-base font-semibold leading-7 text-ink"
      />
    </Card>
  );
}
