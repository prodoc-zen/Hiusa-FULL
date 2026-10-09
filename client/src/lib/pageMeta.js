import { ROLE_HOME_PATHS, getNavForRole, resolveItemPath } from '../components/layout/navigation';

// The single source of truth for what each dashboard route is called: its title, a one-line purpose
// (120 characters at most), the sidebar group it belongs to and the parent pages between the group and
// the page. PageHeader and the layout's default header read it; the TopBar no longer prints a title.
// `group` is the label of a row in the role's sidebar (see navigation.js), so the breadcrumb can link
// it. `byRole` overrides any field for one role, because a few paths serve several roles under
// different names (Calendar for an officer, Events for a student). Every route in client/src/App.jsx
// that renders a page needs an entry; pageMeta.test.js scans App.jsx and fails when one is missing.

const MY_ACTIVITY = { ADMIN: { group: 'My activity' }, SBO_OFFICER: { group: 'My activity' } };
const FINANCE_VIEW_ONLY = { SBO_OFFICER: { group: 'Finance (view only)' } };
const ELECTIONS_STEP = { ADMIN: { parents: [{ label: 'Elections', to: '/dashboard/elections/manage-elections' }] } };

const PAGE_META = {
  '/dashboard': { title: 'Dashboard', purpose: 'Start with what needs your attention today.', isHome: true },

  '/dashboard/super-admin': { title: 'Dashboard', purpose: 'Review reports, administer organizations, and publish university notices.', isHome: true },
  '/dashboard/super-admin/agency': { title: 'Agency overview', purpose: 'Review the agency across organizations, colleges, and compliance.', group: 'Organizations' },
  '/dashboard/super-admin/organizations': { title: 'Registrations and organizations', purpose: 'Review registrations and manage student organizations.', group: 'Organizations' },
  '/dashboard/super-admin/organizations/:organizationId': {
    title: 'Organization overview',
    purpose: 'Review one organization, its members, and its records.',
    group: 'Organizations',
    parents: [{ label: 'Registrations and organizations', to: '/dashboard/super-admin/organizations' }],
  },
  '/dashboard/super-admin/colleges': { title: 'Colleges', purpose: 'Maintain the colleges assigned to student organizations.', group: 'Organizations' },
  '/dashboard/super-admin/admins': { title: 'Administrators', purpose: 'Manage authorized administrators for each organization.', group: 'Organizations' },
  '/dashboard/super-admin/compliance': { title: 'Compliance', purpose: 'Review accreditation, compliance submissions, event files, and financial reports.', group: 'Reviews' },
  '/dashboard/super-admin/venues': { title: 'Venues', purpose: 'Keep the venue catalog current and decide booking requests with conflicts in view.', group: 'Reviews' },
  '/dashboard/super-admin/grievances': { title: 'Grievances', purpose: 'Review every confidential grievance university-wide and set its status.', group: 'Reviews' },
  '/dashboard/super-admin/clearances': { title: 'Clearances', purpose: 'Open a clearance period and track how many students have completed every signature.', group: 'Reviews' },
  '/dashboard/super-admin/announcements': { title: 'University announcements', purpose: 'Publish official notices across HIUSA.', group: 'Updates' },
  '/dashboard/super-admin/notifications': { title: 'Notifications', purpose: 'SAO approval activity and system notices.', group: 'Updates' },
  '/dashboard/super-admin/academic-years': { title: 'Academic years', purpose: 'Set the university-wide academic year and semester that registrations and clearances follow.', group: 'Setup and records' },
  '/dashboard/super-admin/audit-logs': { title: 'Audit trail', purpose: 'Trace who changed a record, what changed, and when.', group: 'Setup and records' },

  '/dashboard/admin': { title: 'Dashboard', purpose: 'See what needs attention and how far your organization has set up HIUSA.', isHome: true },
  '/dashboard/officer': { title: 'Dashboard', purpose: 'Start with deadlines, then check events, funds, and merchandise queues.', isHome: true },
  '/dashboard/department-head': { title: 'Dashboard', purpose: 'Review approvals, elections, events, and announcements.', isHome: true },
  '/dashboard/student': { title: 'Dashboard', purpose: 'Official updates, events, and elections from your organization.', isHome: true },

  '/dashboard/approvals': { title: 'Approvals', purpose: 'Review approval requests awaiting your sign-off.' },
  '/dashboard/department-head/approvals': { title: 'Approvals', purpose: 'Review approval requests awaiting your sign-off.' },
  '/dashboard/department-head/organizations': { title: 'Organizations', purpose: 'Review the student organizations in your college.' },
  '/dashboard/approval-requests/new': { title: 'New request', purpose: 'Choose a request type to begin the approval process.', byRole: { ADMIN: { group: 'Approvals' } } },
  '/dashboard/approval-requests/new/announcement': {
    title: 'Announcement request',
    purpose: 'Submit an announcement for approval.',
    parents: [{ label: 'New request', to: '/dashboard/approval-requests/new' }],
    byRole: { ADMIN: { group: 'Approvals' } },
  },
  '/dashboard/approval-requests/new/budget': {
    title: 'Budget request',
    purpose: 'Submit a budget request for approval.',
    parents: [{ label: 'New request', to: '/dashboard/approval-requests/new' }],
    byRole: { ADMIN: { group: 'Approvals' } },
  },
  '/dashboard/approval-requests/new/event': {
    title: 'Event request',
    purpose: 'Submit an event request for approval.',
    parents: [{ label: 'New request', to: '/dashboard/approval-requests/new' }],
    byRole: { ADMIN: { group: 'Approvals' } },
  },
  '/dashboard/approval-requests/new/election': {
    title: 'Election request',
    purpose: 'Submit an election request for approval.',
    parents: [{ label: 'New request', to: '/dashboard/approval-requests/new' }],
    byRole: { ADMIN: { group: 'Approvals' } },
  },

  '/dashboard/admin/users': {
    title: 'People',
    purpose: 'Search the organization directory and manage account access.',
    group: 'Members',
    byRole: { SBO_OFFICER: { title: 'Members and fingerprints', purpose: 'Search the member directory and enroll fingerprints for attendance.', group: null } },
  },
  '/dashboard/admin/positions': { title: 'Officer positions', purpose: 'Maintain titles available to administrators and officers.', group: 'Members' },
  '/dashboard/admin/programs-sections': { title: 'Programs and sections', purpose: 'Configure programs and update academic records.', group: 'Members' },
  '/dashboard/audit-logs': { title: 'Audit log', purpose: 'Trace who changed a record, what changed, and when.', group: 'Records' },

  '/dashboard/finance': { title: 'Finance', purpose: 'Track organization funds and financial activity.', group: 'Finance', byRole: { ...FINANCE_VIEW_ONLY, STUDENT: { group: 'My payments' } } },
  '/dashboard/finance/budget-allocation': { title: 'Budgets', purpose: 'Plan and review organization budgets.', group: 'Finance', byRole: FINANCE_VIEW_ONLY },
  '/dashboard/finance/financial-ledger': { title: 'Ledger', purpose: 'Review income and expenses in the organization ledger.', group: 'Finance', byRole: FINANCE_VIEW_ONLY },
  '/dashboard/finance/collections': { title: 'Collections and advances', purpose: 'Track money received, its verification and remittance, and cash advances to officers.', group: 'Finance' },
  '/dashboard/finance/student-accounts': { title: 'Student accounts', purpose: 'Review charges, payments, and student clearance.', group: 'Finance' },
  '/dashboard/finance/transaction-history': { title: 'Financial reports', purpose: 'Build financial reports and review the saved ones with their transaction history.', group: 'Finance', byRole: FINANCE_VIEW_ONLY },
  '/dashboard/finance/financial-insights': { title: 'Forecast', purpose: 'Review financial forecasts and trends.', group: 'Finance', byRole: FINANCE_VIEW_ONLY },
  '/dashboard/finance/personal-receipts': { title: 'My receipts', purpose: 'View and print your payment receipts.', byRole: { ...MY_ACTIVITY, STUDENT: { title: 'Receipts', group: 'My payments' } } },
  '/dashboard/finance/statement-of-account': { title: 'Statement of account', purpose: 'Review your account and financial clearance.', byRole: { ...MY_ACTIVITY, STUDENT: { group: 'My payments' } } },

  '/dashboard/events': { title: 'Events', purpose: 'Plan activities and review event records.', group: 'Events and tasks' },
  '/dashboard/events/manage-events': { title: 'Events', purpose: 'Review and update organization events.', group: 'Events and tasks' },
  '/dashboard/events/event-planner': { title: 'Planning', purpose: 'Plan tasks and resources for upcoming events.', group: 'Events and tasks' },
  '/dashboard/events/check-in': { title: 'Check-in', purpose: 'Verify participants and manage event attendance.', group: 'Events and tasks' },
  '/dashboard/events/activity-calendar': {
    title: 'Calendar',
    purpose: 'Browse approved activities and upcoming events.',
    group: 'Events and tasks',
    byRole: { STUDENT: { title: 'Events', group: 'Events' }, DEPARTMENT_HEAD: { group: null } },
  },
  '/dashboard/venues': { title: 'Venue booking', purpose: 'Check availability, request a booking, and track your organization\'s requests.', group: 'Events and tasks' },

  '/dashboard/tasks': { title: 'Tasks', purpose: 'Track assignments and officer progress.', group: 'Events and tasks' },
  '/dashboard/tasks/task-board': { title: 'Tasks', purpose: 'Review work by status and deadline.', group: 'Events and tasks' },
  '/dashboard/tasks/assigned-tasks': { title: 'My tasks', purpose: 'Review work assigned to you.', group: 'Events and tasks' },
  '/dashboard/tasks/ai-delegation': { title: 'AI delegation', purpose: 'Review suggested officers for each task.', group: 'Events and tasks' },

  '/dashboard/elections': { title: 'Elections', purpose: 'Review elections in your organization.', group: 'Voting' },
  '/dashboard/elections/manage-elections': { title: 'Elections', purpose: 'Configure ballots and election schedules.', group: 'Voting' },
  '/dashboard/elections/manage-partylists': { title: 'Party lists', purpose: 'Maintain party identities for the selected election.', group: 'Voting', byRole: ELECTIONS_STEP },
  '/dashboard/elections/manage-candidates': { title: 'Candidates', purpose: 'Review the candidates on the selected ballot.', group: 'Voting', byRole: ELECTIONS_STEP },
  '/dashboard/elections/manage-voters': { title: 'Voters', purpose: 'Review eligibility and turnout without exposing ballots.', group: 'Voting' },
  '/dashboard/elections/cast-vote': { title: 'Vote', purpose: 'Review the ballot and cast your vote.', group: 'Voting', byRole: MY_ACTIVITY },
  '/dashboard/elections/election-results': { title: 'Results', purpose: 'Review available vote totals and winners.', group: 'Voting', byRole: { DEPARTMENT_HEAD: { title: 'Election results', group: null } } },

  '/dashboard/merchandise': { title: 'Merchandise', purpose: 'Browse organization products and orders.', group: 'Store' },
  '/dashboard/merchandise/manage-inventory': { title: 'Inventory', purpose: 'Track products, stock, and sales.', group: 'Store' },
  '/dashboard/merchandise/manage-orders': { title: 'Orders', purpose: 'Review merchandise payments and fulfillment.', group: 'Store' },
  '/dashboard/merchandise/claim-tokens': { title: 'Claim desk', purpose: 'Verify orders and release purchases.', group: 'Store' },
  '/dashboard/merchandise/order-merchandise': { title: 'Shop', purpose: 'Browse products and place an order.', group: 'Store', byRole: MY_ACTIVITY },
  '/dashboard/merchandise/my-orders': { title: 'My orders', purpose: 'Review your purchases and claim details.', group: 'Store', byRole: MY_ACTIVITY },

  '/dashboard/announcements': { title: 'Announcements', purpose: 'Updates from your organization.', group: 'Updates' },
  '/dashboard/announcements/manage-announcements': { title: 'Announcements', purpose: 'Review, edit, and publish organization announcements.', group: 'Updates' },
  '/dashboard/announcements/create-announcement': {
    title: 'New announcement',
    purpose: 'Write an announcement and choose its audience.',
    group: 'Updates',
    parents: [{ label: 'Announcements', to: '/dashboard/announcements/manage-announcements' }],
  },
  '/dashboard/announcements/view-announcements': {
    title: 'Feed',
    purpose: 'Updates from your organization.',
    group: 'Updates',
    byRole: { STUDENT: { title: 'Announcements' }, DEPARTMENT_HEAD: { title: 'Announcements', group: null } },
  },

  '/dashboard/compliance': { title: 'Compliance', purpose: 'Submit and track your organization\'s accreditation requirements.', group: 'Records' },
  '/dashboard/grievances': { title: 'Grievances', purpose: 'Review confidential concerns filed by students against your organization.', group: 'Records' },
  '/dashboard/clearances': { title: 'Clearance signing', purpose: 'Sign, hold, or clear a hold for your organization\'s students.', group: 'Records', byRole: { SBO_OFFICER: { group: null } } },
  '/dashboard/my-grievances': { title: 'My grievances', purpose: 'File a confidential concern and follow how it is handled.', group: 'Support' },
  '/dashboard/my-clearance': { title: 'My clearance', purpose: 'See which signatures you still need and why a clearance is on hold.', group: 'Support' },

  '/dashboard/objectives': { title: 'Study objectives', purpose: 'See each objective the study set out to prove, next to the evidence the system produces.' },
  '/dashboard/profile': { title: 'Profile', purpose: 'Keep your personal details and account access current.' },
};

const STATIC_META = new Map();
const DYNAMIC_META = [];

Object.entries(PAGE_META).forEach(([pattern, entry]) => {
  if (!pattern.includes(':')) {
    STATIC_META.set(pattern, entry);
    return;
  }

  const source = pattern.split('/').map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/');
  DYNAMIC_META.push({ regex: new RegExp(`^${source}$`), entry });
});

const FALLBACK = { title: 'Dashboard', purpose: '', group: null, parents: [], isHome: false, matched: false };

function normalize(pathname) {
  const clean = String(pathname || '').split('?')[0].split('#')[0];
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

function findEntry(pathname) {
  const path = normalize(pathname);
  return STATIC_META.get(path) || DYNAMIC_META.find(({ regex }) => regex.test(path))?.entry || null;
}

export function hasPageMeta(pathname) {
  return findEntry(pathname) !== null;
}

export function getStoredRole() {
  try {
    return JSON.parse(localStorage.getItem('user'))?.role || null;
  } catch {
    return null;
  }
}

export function getPageMeta(pathname, role) {
  const entry = findEntry(pathname);
  if (!entry) return FALLBACK;

  const merged = { ...entry, ...(entry.byRole?.[role] || {}) };
  return {
    title: merged.title,
    purpose: merged.purpose,
    group: merged.group ?? null,
    parents: merged.parents || [],
    isHome: Boolean(merged.isHome),
    matched: true,
  };
}

// A group links to the page its sidebar row opens, which is also where clicking that row goes. It is
// plain text when the role's sidebar has no such row or the link would lead to the page you are on.
function groupLink(group, role, pathname) {
  const row = getNavForRole(role).find((item) => item.label === group);
  if (!row) return undefined;

  const target = resolveItemPath(row);
  return target.split('?')[0] === normalize(pathname) ? undefined : target;
}

// Home / Group / parent pages / Page. Every crumb but the last may carry a link; the last is plain.
export function getBreadcrumbs(pathname, role) {
  const meta = getPageMeta(pathname, role);
  if (!meta.matched) return [];
  if (meta.isHome) return [{ label: 'Home' }];

  const crumbs = [{ label: 'Home', to: ROLE_HOME_PATHS[role] || '/dashboard' }];
  if (meta.group && meta.group.toLowerCase() !== meta.title.toLowerCase()) {
    crumbs.push({ label: meta.group, to: groupLink(meta.group, role, pathname) });
  }
  meta.parents.forEach((parent) => crumbs.push({ label: parent.label, to: parent.to }));
  crumbs.push({ label: meta.title });
  return crumbs;
}
