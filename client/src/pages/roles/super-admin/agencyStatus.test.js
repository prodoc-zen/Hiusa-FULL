import { describe, expect, it } from 'vitest';
import { accreditationBadge } from './agencyStatus';

describe('accreditationBadge', () => {
  it.each([
    ['accredited', 'Accredited', 'success'],
    ['pending_review', 'Pending review', 'info'],
    ['incomplete', 'Incomplete', 'warning'],
    ['returned', 'Returned', 'danger'],
    ['not_applicable', 'Not applicable', 'neutral'],
  ])('maps %s to one label and tone everywhere', (status, label, tone) => {
    expect(accreditationBadge(status)).toEqual({ label, tone });
  });

  it('falls back to not applicable for unknown statuses', () => {
    expect(accreditationBadge('mystery')).toEqual({ label: 'Not applicable', tone: 'neutral' });
  });
});
