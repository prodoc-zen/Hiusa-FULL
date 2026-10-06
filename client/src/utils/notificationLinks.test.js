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
    expect(getNotificationDestination(notification, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/financial-reports');
    expect(getNotificationDestination(notification, 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals');
  });

  it('routes financial reports to recipient inboxes without exposing finance workspaces', () => {
    const notification = { reference_type: 'financial_report' };
    expect(getNotificationDestination(notification, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/financial-reports');
    expect(getNotificationDestination(notification, 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals');
    expect(getNotificationDestination({ reference_type: 'budget' }, 'SUPER_ADMIN')).toBeNull();
    expect(getNotificationDestination({ reference_type: 'financial_report_deadline' }, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/financial-reports');
  });

  it('routes SAO review notices to their workspaces', () => {
    expect(getNotificationDestination({ reference_type: 'organization_compliance_submission' }, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/compliance');
    expect(getNotificationDestination({ reference_type: 'venue_booking' }, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/venues');
    expect(getNotificationDestination({ reference_type: 'grievance' }, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/grievances');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\EvaluationWindow' }, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/evaluation');
  });
});
