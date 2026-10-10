import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getEntityDestination,
  getItemHref,
  getNotificationDestination,
  normalizeReferenceType,
  resolveHrefForRole,
} from './notificationLinks';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

// Every reference_type the server writes into notifications (grep of server/app for reference_type),
// plus the class-name form of the model references.
const REFERENCE_TYPES = [
  'approval_request', 'organization', 'event', 'budget', 'financial_report', 'financial_report_deadline',
  'election', 'announcement', 'task', 'order', 'payment', 'transaction', 'clearance_period',
  'clearance_signature', 'compliance_requirement_type', 'organization_compliance_submission',
  'venue_booking', 'grievance', 'evaluation_window',
];

function readAllowedRoutes() {
  const source = readFileSync(resolve(import.meta.dirname, '../../../server/config/client_routes.php'), 'utf8');
  const allowed = {};
  const roleBlock = /'(SUPER_ADMIN|ADMIN|SBO_OFFICER|DEPARTMENT_HEAD|STUDENT)'\s*=>\s*\[([^\]]*)\]/g;
  for (const [, role, body] of source.matchAll(roleBlock)) {
    allowed[role] = [...body.matchAll(/'(\/dashboard[^']*)'/g)].map((match) => match[1]);
  }
  return allowed;
}

const ALLOWED = readAllowedRoutes();

function isAllowed(role, destination) {
  const path = destination.split(/[?#]/)[0];
  return ALLOWED[role].some((route) => route === path);
}

// What each reference type lands on, per role. null means the role has no page for it.
const EXPECTED = {
  approval_request: {
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=financial',
    ADMIN: '/dashboard/approvals?record=7',
    SBO_OFFICER: null,
    DEPARTMENT_HEAD: '/dashboard/department-head/approvals?record=7',
    STUDENT: null,
  },
  organization: {
    SUPER_ADMIN: '/dashboard/super-admin/organizations?status=pending&review=7',
    ADMIN: null,
    SBO_OFFICER: null,
    DEPARTMENT_HEAD: '/dashboard/department-head/organizations?record=7',
    STUDENT: null,
  },
  event: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/events/manage-events?record=7',
    SBO_OFFICER: '/dashboard/events/activity-calendar?record=7',
    DEPARTMENT_HEAD: '/dashboard/events/activity-calendar?record=7',
    STUDENT: '/dashboard/events/activity-calendar?record=7',
  },
  budget: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/finance/budget-allocation?record=7',
    SBO_OFFICER: '/dashboard/finance/budget-allocation?record=7',
    DEPARTMENT_HEAD: '/dashboard/finance/budget-allocation?record=7',
    STUDENT: null,
  },
  financial_report: {
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=financial',
    ADMIN: '/dashboard/finance/transaction-history?record=7',
    SBO_OFFICER: '/dashboard/finance/transaction-history?record=7',
    DEPARTMENT_HEAD: '/dashboard/finance/transaction-history?record=7',
    STUDENT: null,
  },
  financial_report_deadline: {
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=financial',
    ADMIN: '/dashboard/finance/transaction-history',
    SBO_OFFICER: null,
    DEPARTMENT_HEAD: null,
    STUDENT: null,
  },
  election: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/elections/manage-elections?record=7',
    SBO_OFFICER: '/dashboard/elections/cast-vote',
    DEPARTMENT_HEAD: '/dashboard/elections/election-results',
    STUDENT: '/dashboard/elections/cast-vote',
  },
  announcement: {
    SUPER_ADMIN: '/dashboard/super-admin/announcements',
    ADMIN: '/dashboard/announcements/manage-announcements',
    SBO_OFFICER: '/dashboard/announcements/manage-announcements',
    DEPARTMENT_HEAD: '/dashboard/announcements/view-announcements',
    STUDENT: '/dashboard/announcements/view-announcements',
  },
  task: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/tasks/task-board?record=7',
    SBO_OFFICER: '/dashboard/tasks/assigned-tasks?record=7',
    DEPARTMENT_HEAD: null,
    STUDENT: null,
  },
  order: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/merchandise/manage-orders?record=7',
    SBO_OFFICER: '/dashboard/merchandise/manage-orders?record=7',
    DEPARTMENT_HEAD: null,
    STUDENT: '/dashboard/merchandise/my-orders?record=7',
  },
  payment: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/merchandise/my-orders?record=7',
    SBO_OFFICER: '/dashboard/merchandise/my-orders?record=7',
    DEPARTMENT_HEAD: null,
    STUDENT: '/dashboard/merchandise/my-orders?record=7',
  },
  transaction: {
    SUPER_ADMIN: null,
    ADMIN: '/dashboard/finance/personal-receipts',
    SBO_OFFICER: '/dashboard/finance/personal-receipts',
    DEPARTMENT_HEAD: null,
    STUDENT: '/dashboard/finance/personal-receipts',
  },
  clearance_period: {
    SUPER_ADMIN: '/dashboard/super-admin/clearances',
    ADMIN: '/dashboard/clearances',
    SBO_OFFICER: '/dashboard/clearances',
    DEPARTMENT_HEAD: null,
    STUDENT: '/dashboard/my-clearance',
  },
  clearance_signature: {
    SUPER_ADMIN: '/dashboard/super-admin/clearances',
    ADMIN: '/dashboard/clearances',
    SBO_OFFICER: '/dashboard/clearances',
    DEPARTMENT_HEAD: null,
    STUDENT: '/dashboard/my-clearance',
  },
  compliance_requirement_type: {
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=requirements',
    ADMIN: '/dashboard/compliance',
    SBO_OFFICER: null,
    DEPARTMENT_HEAD: null,
    STUDENT: null,
  },
  organization_compliance_submission: {
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=review',
    ADMIN: '/dashboard/compliance',
    SBO_OFFICER: null,
    DEPARTMENT_HEAD: null,
    STUDENT: null,
  },
  venue_booking: {
    SUPER_ADMIN: '/dashboard/super-admin/venues',
    ADMIN: '/dashboard/venues',
    SBO_OFFICER: '/dashboard/venues',
    DEPARTMENT_HEAD: null,
    STUDENT: null,
  },
  grievance: {
    SUPER_ADMIN: '/dashboard/super-admin/grievances',
    ADMIN: '/dashboard/grievances',
    SBO_OFFICER: null,
    DEPARTMENT_HEAD: null,
    STUDENT: '/dashboard/my-grievances',
  },
  evaluation_window: {
    SUPER_ADMIN: null, ADMIN: null, SBO_OFFICER: null, DEPARTMENT_HEAD: null, STUDENT: null,
  },
};

describe('getNotificationDestination table', () => {
  it('parsed the route allowlist for every role', () => {
    for (const role of ROLES) expect(ALLOWED[role]?.length, role).toBeGreaterThan(10);
    expect(ALLOWED.DEPARTMENT_HEAD).toContain('/dashboard/department-head/approvals');
    expect(ALLOWED.STUDENT).not.toContain('/dashboard/venues');
  });

  it('covers every reference type the server emits', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...REFERENCE_TYPES].sort());
  });

  for (const type of REFERENCE_TYPES) {
    for (const role of ROLES) {
      const expected = EXPECTED[type][role];
      it(`${type} for ${role} lands on ${expected ?? 'no link'}`, () => {
        expect(getNotificationDestination({ reference_type: type, reference_id: 7, notification_type: 'general' }, role)).toBe(expected);
      });
    }
  }

  it('never returns a route the role cannot open, for every type, role and notification type', () => {
    const notificationTypes = ['general', 'event', 'announcement', 'task', 'election', 'merchandise', 'financial'];
    for (const type of REFERENCE_TYPES) {
      for (const role of ROLES) {
        for (const notificationType of notificationTypes) {
          for (const id of [7, null, undefined]) {
            const destination = getNotificationDestination({ reference_type: type, reference_id: id, notification_type: notificationType }, role);
            if (destination !== null) {
              expect(isAllowed(role, destination), `${type} ${notificationType} for ${role}: ${destination}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('gives every role that can open a page for a type a link, not null', () => {
    const openable = {
      approval_request: ['ADMIN', 'DEPARTMENT_HEAD'],
      event: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'],
      venue_booking: ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER'],
      grievance: ['SUPER_ADMIN', 'ADMIN', 'STUDENT'],
    };
    for (const [type, roles] of Object.entries(openable)) {
      for (const role of roles) {
        expect(getNotificationDestination({ reference_type: type, reference_id: 1 }, role), `${type} for ${role}`).not.toBeNull();
      }
    }
  });
});

describe('getNotificationDestination rules', () => {
  it('reads the model class name the server stores', () => {
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Event', reference_id: 4 }, 'STUDENT')).toBe('/dashboard/events/activity-calendar?record=4');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Order', reference_id: 4 }, 'STUDENT')).toBe('/dashboard/merchandise/my-orders?record=4');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\Task', reference_id: 4 }, 'ADMIN')).toBe('/dashboard/tasks/task-board?record=4');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\FinancialReport', reference_id: 4 }, 'ADMIN')).toBe('/dashboard/finance/transaction-history?record=4');
    expect(getNotificationDestination({ reference_type: 'App\\Models\\EvaluationWindow', reference_id: 4 }, 'SUPER_ADMIN')).toBeNull();
  });

  it('does not let the title change the destination', () => {
    const base = { reference_type: 'App\\Models\\Order', reference_id: 9, notification_type: 'financial' };
    for (const title of ['Payment awaiting review', 'Payment Approved', 'Order ready', 'Approval request submitted']) {
      expect(getNotificationDestination({ ...base, title }, 'ADMIN')).toBe('/dashboard/merchandise/manage-orders?record=9');
      expect(getNotificationDestination({ ...base, title }, 'STUDENT')).toBe('/dashboard/merchandise/my-orders?record=9');
    }
    const event = { reference_type: 'event', reference_id: 3 };
    expect(getNotificationDestination({ ...event, title: 'Approval Request Approved' }, 'ADMIN')).toBe('/dashboard/events/manage-events?record=3');
    expect(getNotificationDestination({ ...event, title: 'Event Reminder: Foundation Week' }, 'ADMIN')).toBe('/dashboard/events/manage-events?record=3');
  });

  it('lands approval notices on the approvals page of the role that can act, with the approval id', () => {
    const notification = { reference_type: 'approval_request', reference_id: 31, notification_type: 'general', title: 'Approval Request Submitted' };
    expect(getNotificationDestination(notification, 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals?record=31');
    expect(getNotificationDestination(notification, 'ADMIN')).toBe('/dashboard/approvals?record=31');
  });

  it('sends an announcement decision to the requester and a broadcast to the feed', () => {
    const decision = { reference_type: 'announcement', reference_id: 2, notification_type: 'general' };
    const broadcast = { reference_type: 'announcement', reference_id: 2, notification_type: 'announcement' };
    expect(getNotificationDestination(decision, 'SBO_OFFICER')).toBe('/dashboard/announcements/manage-announcements');
    expect(getNotificationDestination(broadcast, 'SBO_OFFICER')).toBe('/dashboard/announcements/view-announcements');
    expect(getNotificationDestination(broadcast, 'STUDENT')).toBe('/dashboard/announcements/view-announcements');
  });

  it('keeps a list link when the notification has no usable id and drops unsafe ids', () => {
    expect(getNotificationDestination({ reference_type: 'event', reference_id: null }, 'ADMIN')).toBe('/dashboard/events/manage-events');
    expect(getNotificationDestination({ reference_type: 'event', reference_id: '1&view=x' }, 'ADMIN')).toBe('/dashboard/events/manage-events');
    expect(getNotificationDestination({ reference_type: 'approval_request', reference_id: 'a/b' }, 'ADMIN')).toBe('/dashboard/approvals');
  });

  it('returns null for unknown types, missing references and unknown roles', () => {
    expect(getNotificationDestination({ reference_type: 'something_new', reference_id: 1 }, 'ADMIN')).toBeNull();
    expect(getNotificationDestination({ reference_type: null }, 'ADMIN')).toBeNull();
    expect(getNotificationDestination(null, 'ADMIN')).toBeNull();
    expect(getNotificationDestination({ reference_type: 'event', reference_id: 1 }, 'constructor')).toBeNull();
    expect(getNotificationDestination({ reference_type: 'event', reference_id: 1 }, undefined)).toBeNull();
    expect(getNotificationDestination({ reference_type: 'constructor', reference_id: 1 }, 'ADMIN')).toBeNull();
  });
});

describe('entity and item helpers', () => {
  it('builds the same deep link for an entity as for a notification', () => {
    expect(getEntityDestination('budget', 12, 'ADMIN')).toBe('/dashboard/finance/budget-allocation?record=12');
    expect(getEntityDestination('approval', 5, 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals?record=5');
    expect(normalizeReferenceType('App\\Models\\FinancialReport')).toBe('financial_report');
  });

  it('keeps the server href and builds one only when it is missing', () => {
    expect(getItemHref({ href: '/dashboard/super-admin/compliance?tab=review', entity_type: 'event', entity_id: 1 }, 'SUPER_ADMIN')).toBe('/dashboard/super-admin/compliance?tab=review');
    expect(getItemHref({ href: null, entity_type: 'event', entity_id: 1 }, 'ADMIN')).toBe('/dashboard/events/manage-events?record=1');
    expect(getItemHref({ href: null }, 'ADMIN')).toBeNull();
    expect(getItemHref({ href: null, entity_type: 'event', entity_id: 1 }, 'SUPER_ADMIN')).toBeNull();
  });

  it('points the Department Head at the one approvals route and leaves every other role alone', () => {
    expect(resolveHrefForRole('/dashboard/approvals', 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals');
    expect(resolveHrefForRole('/dashboard/approvals?record=4', 'DEPARTMENT_HEAD')).toBe('/dashboard/department-head/approvals?record=4');
    expect(resolveHrefForRole('/dashboard/approvals-archive', 'DEPARTMENT_HEAD')).toBe('/dashboard/approvals-archive');
    expect(resolveHrefForRole('/dashboard/approvals?record=4', 'ADMIN')).toBe('/dashboard/approvals?record=4');
    expect(resolveHrefForRole(null, 'ADMIN')).toBeNull();
  });
});
