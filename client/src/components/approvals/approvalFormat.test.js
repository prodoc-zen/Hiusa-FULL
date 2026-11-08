import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, summaryLine } from './approvalFormat';

describe('approval date formatting', () => {
  it('shows Manila time whatever the browser clock says', () => {
    // 03:51 on Nov 9 in Manila is 19:51 on Nov 8 in UTC.
    expect(formatDateTime('2026-11-08T19:51:00.000000Z')).toBe('Nov 9, 2026, 3:51 AM');
    expect(formatDate('2026-11-08T19:51:00.000000Z')).toBe('Nov 9, 2026');
  });

  it('describes an election window in plain words, with no status code', () => {
    const line = summaryLine('election', {
      start_time: '2027-01-05T01:00:00.000000Z',
      end_time: '2027-01-05T09:00:00.000000Z',
      target_status: 'pending_approval',
    });

    expect(line).toBe('Voting Jan 5, 2027, 9:00 AM to Jan 5, 2027, 5:00 PM');
    expect(line).not.toContain('pending_approval');
  });

  it('describes an announcement with the audience and category as words and no status code', () => {
    const line = summaryLine('announcement', { target_role: 'SBO_OFFICER', category: 'training', approval_status: 'pending' });

    expect(line).toBe('Audience: Officer | Category: Training');
    expect(line).not.toMatch(/SBO_OFFICER|pending|Status/);
    expect(summaryLine('announcement', { target_role: 'all', category: null, approval_status: 'pending' })).toBe('Audience: Everyone | Category: General');
    expect(summaryLine('announcement', { target_role: 'DEPARTMENT_HEAD', category: 'events' })).toBe('Audience: Department Head | Category: Events');
  });
});
