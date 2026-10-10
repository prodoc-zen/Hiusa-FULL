import { describe, expect, it } from 'vitest';
import { buildReviewAreas, reviewHeadline } from './reviewQueues';

const item = (type, extra = {}) => ({ id: `${type}-${Math.random()}`, type, severity: 'medium', title: type, detail: '', due_at: null, href: `/h/${type}`, ...extra });

describe('buildReviewAreas', () => {
  it('lists the SAO queues in working order with registrations first', () => {
    const areas = buildReviewAreas([
      item('clearance_sao_pending', { count: 2 }),
      item('grievances_urgent', { count: 1 }),
      item('venue_bookings_pending', { count: 3 }),
      item('compliance_submissions_pending', { count: 4 }),
      item('registrations_pending', { count: 5 }),
    ]);

    expect(areas.map((area) => [area.key, area.count])).toEqual([
      ['registrations', 5], ['compliance', 4], ['venues', 3], ['grievances', 1], ['clearances', 2],
    ]);
  });

  it('splits approval items by the tab their link opens and counts one record each', () => {
    const areas = buildReviewAreas([
      item('approval', { href: '/dashboard/super-admin/compliance?tab=financial' }),
      item('approval', { href: '/dashboard/super-admin/compliance?tab=financial' }),
      item('approval', { href: '/dashboard/super-admin/compliance?tab=events' }),
      item('approval', { href: '/dashboard/super-admin/compliance' }),
      item('financial_report_due', { href: '/dashboard/super-admin/compliance?tab=financial' }),
    ]);

    expect(areas.map((area) => [area.key, area.count])).toEqual([
      ['financial-reports', 2], ['reports-overdue', 1], ['event-files', 1], ['budgets', 1],
    ]);
    expect(areas[0].href).toBe('/dashboard/super-admin/compliance?tab=financial');
  });

  it('marks a count the 8 row cap cut short, and keeps a null href as no link', () => {
    const approvals = Array.from({ length: 8 }, () => item('approval', { href: null, type_total: 23 }));
    const [area] = buildReviewAreas(approvals);
    expect(area.count).toBe(8);
    expect(area.truncated).toBe(true);
    expect(area.href).toBeNull();
    expect(reviewHeadline([area])).toBe('8 items need your attention: 8+ budgets.');
  });

  it('skips areas with no work and ignores types that are not SAO queues', () => {
    expect(buildReviewAreas([item('task_overdue')])).toEqual([]);
    expect(buildReviewAreas()).toEqual([]);
  });
});

describe('reviewHeadline', () => {
  it('counts every queue in one sentence', () => {
    const areas = buildReviewAreas([item('registrations_pending', { count: 1 }), item('grievances_urgent', { count: 2 })]);
    expect(reviewHeadline(areas)).toBe('3 items need your attention: 1 registration, 2 urgent grievances.');
  });

  it('uses the singular for one', () => {
    expect(reviewHeadline(buildReviewAreas([item('clearance_sao_pending', { count: 1 })]))).toBe('1 item needs your attention: 1 clearance.');
  });
});
