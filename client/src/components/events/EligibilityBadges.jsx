import { StatusBadge } from '../ui';

const ENROLLMENT = {
  enrolled: { tone: 'success', label: 'Enrolled' },
  not_in_records: { tone: 'warning', label: 'Not in school records' },
  not_checked: { tone: 'neutral', label: 'Not checked' },
};

const DUES = {
  unpaid: { tone: 'warning', label: 'Dues unpaid' },
  overdue: { tone: 'warning', label: 'Dues overdue' },
};

// Text on every badge, so the flag never rests on colour alone. In a list only the problems show; the check-in form
// shows the whole picture, including a clear standing, before the officer confirms.
export default function EligibilityBadges({ eligibility, problemsOnly = false }) {
  if (!eligibility) return null;
  const enrollment = ENROLLMENT[eligibility.enrollment] || ENROLLMENT.not_checked;
  const dues = DUES[eligibility.dues] || (problemsOnly ? null : { tone: 'success', label: 'Dues paid' });
  const badges = [
    (!problemsOnly || eligibility.enrollment === 'not_in_records') && enrollment,
    dues,
  ].filter(Boolean);
  if (badges.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => <StatusBadge key={badge.label} tone={badge.tone} label={badge.label} />)}
    </span>
  );
}
