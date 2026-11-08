import { StatusBadge } from '../../../components/ui';
import { GRIEVANCE_STATUS_LABEL, grievanceStageText, grievanceStatusTone, urgencyTone } from './grievanceLabels';

// Only the states that ask for attention carry a badge. Medium and Low urgency, and a grievance that is
// still open, read as plain text so the table does not fill with default-state badges.
const BADGED_URGENCIES = ['Critical', 'High'];

export function UrgencyCell({ urgency, suffix = '' }) {
  if (BADGED_URGENCIES.includes(urgency)) return <StatusBadge tone={urgencyTone(urgency)} label={`${urgency}${suffix}`} />;
  return <span className="text-sm text-ink-muted">{urgency}{suffix}</span>;
}

// An open grievance shows the sentence that says who acts next. A closed one shows its outcome once, as a
// badge, because the sentence for a closed grievance is the same word.
export function StatusCell({ grievance }) {
  if (grievance.status === 'resolved' || grievance.status === 'dismissed') {
    return <StatusBadge tone={grievanceStatusTone(grievance.status)} label={GRIEVANCE_STATUS_LABEL[grievance.status]} />;
  }
  return <span className="text-sm text-ink">{grievanceStageText(grievance)}</span>;
}
