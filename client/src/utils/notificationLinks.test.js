import { describe, expect, it } from 'vitest';
import { getNotificationDestination } from './notificationLinks';

describe('getNotificationDestination', () => {
  it('routes model references to the related workspace', () => {
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Event' }, 'STUDENT')).toBe('/dashboard/events/activity-calendar');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Task' }, 'ADMIN')).toBe('/dashboard/tasks/task-progress');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Transaction' }, 'STUDENT')).toBe('/dashboard/finance/personal-receipts');
  });

  it('routes payment review notices differently from buyer updates', () => {
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Order', title: 'Payment awaiting review' }, 'ADMIN')).toBe('/dashboard/merchandise/manage-orders');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Order', title: 'Payment Approved' }, 'ADMIN')).toBe('/dashboard/merchandise/my-orders');
  });

  it('keeps approval queues role-specific', () => {
    const notification = { reference_type: 'approval_request' };
    expect(getNotificationDestination(notification, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/approvals');
    expect(getNotificationDestination(notification, 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals');
  });
});
