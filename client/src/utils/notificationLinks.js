// Where a notification, briefing item or approval lands. The destination is decided only by the
// reference type (the model or entity the server attached), its id and the notification type, never
// by the words in a title. A role that cannot open the page for a type gets null (no link), because
// server/config/client_routes.php is the list of routes each role may open and a forbidden route is
// a silent bounce to the home page. notificationLinks.test.js cross-checks every result against it.

import { roleLabel } from '../lib/lifecycle';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const APPROVALS = { ADMIN: '/dashboard/approvals', DEPARTMENT_HEAD: '/dashboard/department-head/approvals' };

const CLEARANCE = {
  STUDENT: '/dashboard/my-clearance',
  ADMIN: '/dashboard/clearances',
  SBO_OFFICER: '/dashboard/clearances',
  SUPER_ADMIN: '/dashboard/super-admin/clearances',
};

const TYPE_ALIASES = {
  approval: 'approval_request',
  financialreport: 'financial_report',
  evaluationwindow: 'evaluation_window',
};

function safeId(id) {
  const value = String(id ?? '');
  return SAFE_ID.test(value) ? value : null;
}

function record(path, id) {
  const value = safeId(id);
  return value ? `${path}?record=${value}` : path;
}

function pick(map, role) {
  return Object.hasOwn(map, role) ? map[role] : null;
}

export function normalizeReferenceType(rawType) {
  const type = String(rawType || '').toLowerCase().split('\\').pop().split('/').pop();
  return TYPE_ALIASES[type] ?? type;
}

// An approval decision notice (notification_type general) carries the approved entity as its
// reference, so for an announcement it reaches the requester, who manages announcements. A broadcast
// (notification_type announcement) reaches everyone, who reads the feed.
function announcementDestination(role, notificationType) {
  if (role === 'SUPER_ADMIN') return '/dashboard/super-admin/announcements';
  if (notificationType !== 'announcement' && (role === 'ADMIN' || role === 'SBO_OFFICER')) {
    return '/dashboard/announcements/manage-announcements';
  }
  return '/dashboard/announcements/view-announcements';
}

// Admin and Officer receive order notices both as the fulfillment team and as a buyer, and both
// carry the same reference and type, so they land on the orders list, which holds both.
function orderDestination(role, id) {
  if (role === 'ADMIN' || role === 'SBO_OFFICER') return record('/dashboard/merchandise/manage-orders', id);
  if (role === 'STUDENT') return record('/dashboard/merchandise/my-orders', id);
  return null;
}

const DESTINATIONS = {
  // The notification carries the approval id but not its entity type. The SAO's reports always reach
  // it and events only sometimes, so it lands on the Financial reports tab.
  approval_request: (role, id) => {
    if (Object.hasOwn(APPROVALS, role)) return record(APPROVALS[role], id);
    return role === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance?tab=financial' : null;
  },

  organization: (role, id) => {
    const value = safeId(id);
    if (role === 'SUPER_ADMIN') return value ? `/dashboard/super-admin/organizations?status=pending&review=${value}` : '/dashboard/super-admin/organizations?status=pending';
    if (role === 'DEPARTMENT_HEAD') return record('/dashboard/department-head/organizations', id);
    return null;
  },

  event: (role, id) => {
    if (role === 'ADMIN') return record('/dashboard/events/manage-events', id);
    if (role === 'SBO_OFFICER' || role === 'DEPARTMENT_HEAD' || role === 'STUDENT') return record('/dashboard/events/activity-calendar', id);
    return null;
  },

  budget: (role, id) => (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(role) ? record('/dashboard/finance/budget-allocation', id) : null),

  financial_report: (role, id) => {
    if (role === 'SUPER_ADMIN') return '/dashboard/super-admin/compliance?tab=financial';
    return ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(role) ? record('/dashboard/finance/transaction-history', id) : null;
  },

  financial_report_deadline: (role) => pick({
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=financial',
    ADMIN: '/dashboard/finance/transaction-history',
  }, role),

  election: (role, id) => pick({
    ADMIN: record('/dashboard/elections/manage-elections', id),
    SBO_OFFICER: '/dashboard/elections/cast-vote',
    STUDENT: '/dashboard/elections/cast-vote',
    DEPARTMENT_HEAD: '/dashboard/elections/election-results',
  }, role),

  announcement: (role, _id, notificationType) => announcementDestination(role, notificationType),

  task: (role, id) => pick({
    ADMIN: record('/dashboard/tasks/task-board', id),
    SBO_OFFICER: record('/dashboard/tasks/assigned-tasks', id),
  }, role),

  order: (role, id) => orderDestination(role, id),
  payment: (role, id) => (['ADMIN', 'SBO_OFFICER', 'STUDENT'].includes(role) ? record('/dashboard/merchandise/my-orders', id) : null),

  transaction: (role) => (['ADMIN', 'SBO_OFFICER', 'STUDENT'].includes(role) ? '/dashboard/finance/personal-receipts' : null),

  clearance_period: (role) => pick(CLEARANCE, role),
  clearance_signature: (role) => pick(CLEARANCE, role),

  compliance_requirement_type: (role) => pick({
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=requirements',
    ADMIN: '/dashboard/compliance',
  }, role),

  organization_compliance_submission: (role) => pick({
    SUPER_ADMIN: '/dashboard/super-admin/compliance?tab=review',
    ADMIN: '/dashboard/compliance',
  }, role),

  venue_booking: (role) => pick({
    SUPER_ADMIN: '/dashboard/super-admin/venues',
    ADMIN: '/dashboard/venues',
    SBO_OFFICER: '/dashboard/venues',
  }, role),

  grievance: (role) => pick({
    SUPER_ADMIN: '/dashboard/super-admin/grievances',
    ADMIN: '/dashboard/grievances',
    STUDENT: '/dashboard/my-grievances',
  }, role),
};

/**
 * Destination for something that references an entity: a notification (reference_type,
 * reference_id, notification_type) or a briefing item (entity_type, entity_id). Returns null when the
 * role has no page for that entity or the type is unknown.
 */
export function getEntityDestination(entityType, entityId, role, notificationType = null) {
  const type = normalizeReferenceType(entityType);
  if (!Object.hasOwn(DESTINATIONS, type)) return null;
  return DESTINATIONS[type](role, entityId, String(notificationType || '').toLowerCase()) ?? null;
}

export function getNotificationDestination(notification, role) {
  return getEntityDestination(notification?.reference_type, notification?.reference_id, role, notification?.notification_type);
}

// The Department Head has one approvals page. /dashboard/approvals redirects there but drops the
// query, so a record link has to name the real route.
export function resolveHrefForRole(href, role) {
  if (!href || role !== 'DEPARTMENT_HEAD') return href ?? null;
  return href.replace(/^\/dashboard\/approvals(?=$|[?#])/, APPROVALS.DEPARTMENT_HEAD);
}

/**
 * The link for a dashboard item: the href the server provided, or when it gave none, the deep link
 * for its entity_type and entity_id.
 */
export function getItemHref(item, role) {
  const provided = item?.href || (item?.entity_type ? getEntityDestination(item.entity_type, item.entity_id, role) : null);
  return resolveHrefForRole(provided, role);
}

export function getStoredRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role ?? null;
  } catch {
    return null;
  }
}

/** "Waiting on <who>" text for an item whose server payload names the party it is waiting on. */
export function getWaitingOnLabel(item) {
  const waitingOn = item?.waiting_on;
  if (!waitingOn) return null;
  return `Waiting on ${roleLabel(waitingOn) ?? waitingOn}`;
}
