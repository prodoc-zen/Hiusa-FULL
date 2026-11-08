import Card from '../../../components/ui/Card';
import StatusBadge from '../../../components/ui/StatusBadge';
import ObjectiveDetails from './ObjectiveDetails';
import { presentStatus } from './objectivesFormat';

export default function SynthesisSection({ objective }) {
  if (!objective) return null;

  const { tone, label } = presentStatus(objective.status);

  return (
    <Card
      title={`${objective.code}: ${objective.title}`}
      actions={<StatusBadge status={objective.status} tone={tone} label={label} />}
    >
      <ObjectiveDetails objective={objective} fallbackLabel="a guided run-through" />
    </Card>
  );
}
