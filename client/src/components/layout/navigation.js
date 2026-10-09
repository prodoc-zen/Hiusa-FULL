import {
  BadgeCheck, BookOpen, Bot, Building2, CalendarDays, ChartColumn, ClipboardCheck, ClipboardList, CreditCard,
  FileText, Fingerprint, Flag, GraduationCap, History, Home, LayoutDashboard, ListChecks, MapPin, Megaphone,
  MessageSquare, Newspaper, Package, ReceiptText, SearchCheck, Settings, ShieldCheck, ShoppingCart, Store,
  TicketCheck, User, Users, UsersRound, Vote, WalletCards,
} from 'lucide-react';
import { PILLAR_BY_KEY } from '../../lib/pillars';

// Single source of truth for the sidebar. Each role has its own ordered list of rows, written in the
// order the work happens (docs/UX_FLOW.md section 3.2). Sidebar.jsx renders it, CommandPalette.jsx
// flattens it for search and lib/pageMeta.js reads it to link a breadcrumb's group. A role only ever
// gets a link it can open: keep every path here in step with the guards in client/src/App.jsx.

export const ROLE_LABELS = {
  SUPER_ADMIN: 'SAO',
  ADMIN: 'Organization Admin',
  SBO_OFFICER: 'SBO Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

export const ROLE_HOME_PATHS = {
  SUPER_ADMIN: '/dashboard/super-admin',
  ADMIN: '/dashboard/admin',
  SBO_OFFICER: '/dashboard/officer',
  DEPARTMENT_HEAD: '/dashboard/department-head',
  STUDENT: '/dashboard/student',
};

const financePillar = PILLAR_BY_KEY.finance;
const eventsPillar = PILLAR_BY_KEY.events;
const electionsPillar = PILLAR_BY_KEY.elections;
const merchandisePillar = PILLAR_BY_KEY.merchandise;
const communicationPillar = PILLAR_BY_KEY.communication;

// `aliases` are the labels a page used to carry; the command palette still finds the page by them.
// `also` lists extra paths that keep the item highlighted (a step of the same hub, a demoted page).
const leaf = (id, label, path, icon, extra = {}) => ({ id, label, path, icon, ...extra });
const group = (id, label, icon, children, extra = {}) => ({ id, label, icon, children, ...extra });

const L = {
  people: leaf('manage-users', 'People', '/dashboard/admin/users', UsersRound, { aliases: ['Manage Users', 'User Management'] }),
  positions: leaf('manage-positions', 'Officer positions', '/dashboard/admin/positions', BadgeCheck, { aliases: ['Manage Positions', 'SBO positions'], also: ['/dashboard/admin/sbo-positions'] }),
  programs: leaf('manage-programs-sections', 'Programs and sections', '/dashboard/admin/programs-sections', GraduationCap, { aliases: ['Programs & Sections'] }),

  budgets: leaf('budget-allocation', 'Budgets', '/dashboard/finance/budget-allocation', CreditCard, { aliases: ['Budget Allocation'] }),
  ledger: leaf('financial-ledger', 'Ledger', '/dashboard/finance/financial-ledger', BookOpen, { aliases: ['Digital Ledger'] }),
  collections: leaf('collections', 'Collections and advances', '/dashboard/finance/collections', WalletCards, { aliases: ['Collections & Advances'] }),
  studentAccounts: leaf('student-accounts', 'Student accounts', '/dashboard/finance/student-accounts', UsersRound, { aliases: ['Student Financial Accounts'] }),
  reports: leaf('transaction-history', 'Financial reports', '/dashboard/finance/transaction-history', History, { aliases: ['Transaction History'] }),
  forecast: leaf('financial-insights', 'Forecast', '/dashboard/finance/financial-insights', ChartColumn, { aliases: ['Financial Insights'] }),

  events: leaf('manage-events', 'Events', '/dashboard/events/manage-events', CalendarDays, { aliases: ['Manage Events'] }),
  venues: leaf('gov-venues', 'Venue booking', '/dashboard/venues', MapPin, { aliases: ['Venues'] }),
  planning: leaf('event-planner', 'Planning', '/dashboard/events/event-planner', ClipboardList, { aliases: ['Event Planner'] }),
  tasks: leaf('task-board', 'Tasks', '/dashboard/tasks/task-board', ListChecks, { aliases: ['Task Board'], also: ['/dashboard/tasks/create-task', '/dashboard/tasks/task-progress'] }),
  myTasks: leaf('assigned-tasks', 'My tasks', '/dashboard/tasks/assigned-tasks', ClipboardCheck, { aliases: ['Assigned Tasks'] }),
  aiDelegation: leaf('ai-delegation', 'AI delegation', '/dashboard/tasks/ai-delegation', Bot, { aliases: ['AI Delegation'] }),
  checkIn: leaf('check-in', 'Check-in', '/dashboard/events/check-in', Fingerprint, { aliases: ['Check In', 'Event Check-In'] }),
  calendar: leaf('activity-calendar', 'Calendar', '/dashboard/events/activity-calendar', CalendarDays, { aliases: ['Activity Calendar'] }),

  elections: leaf('manage-elections', 'Elections', '/dashboard/elections/manage-elections', Vote, {
    aliases: ['Manage Elections'],
    also: ['/dashboard/elections/manage-partylists', '/dashboard/elections/manage-candidates'],
  }),
  candidates: leaf('manage-candidates', 'Candidates', '/dashboard/elections/manage-candidates', UsersRound, { aliases: ['Manage Candidates'] }),
  voters: leaf('manage-voters', 'Voters', '/dashboard/elections/manage-voters', BadgeCheck, { aliases: ['Manage Voters'] }),
  results: leaf('election-results', 'Results', '/dashboard/elections/election-results', ChartColumn, { aliases: ['Election Results'] }),

  inventory: leaf('manage-inventory', 'Inventory', '/dashboard/merchandise/manage-inventory', Package),
  orders: leaf('manage-orders', 'Orders', '/dashboard/merchandise/manage-orders', ShoppingCart, { aliases: ['Manage Orders'] }),
  claimDesk: leaf('claim-tokens', 'Claim desk', '/dashboard/merchandise/claim-tokens', TicketCheck, { aliases: ['Validate Tokens', 'Claim Tokens'] }),

  announcements: leaf('manage-announcements', 'Announcements', '/dashboard/announcements/manage-announcements', Megaphone, {
    aliases: ['Manage Announcements'],
    also: ['/dashboard/announcements/create-announcement'],
  }),
  feed: leaf('view-announcements', 'Feed', '/dashboard/announcements/view-announcements', Newspaper, { aliases: ['Announcements Feed'] }),

  compliance: leaf('gov-compliance', 'Compliance', '/dashboard/compliance', ClipboardCheck),
  grievances: leaf('gov-grievances', 'Grievances', '/dashboard/grievances', MessageSquare),
  clearanceSigning: leaf('gov-clearances', 'Clearance signing', '/dashboard/clearances', ShieldCheck, { aliases: ['Clearances'] }),
  auditLog: leaf('audit-logs', 'Audit log', '/dashboard/audit-logs', History, { aliases: ['General Audit Log'] }),

  vote: leaf('cast-vote', 'Vote', '/dashboard/elections/cast-vote', Vote, { aliases: ['Cast Vote'] }),
  shop: leaf('order-merchandise', 'Shop', '/dashboard/merchandise/order-merchandise', Store, { aliases: ['Order Merchandise'] }),
  myOrders: leaf('my-orders', 'My orders', '/dashboard/merchandise/my-orders', ReceiptText, { aliases: ['My Orders'] }),
  myReceipts: leaf('personal-receipts', 'My receipts', '/dashboard/finance/personal-receipts', ReceiptText, { aliases: ['My Receipts', 'Receipts'] }),
  statement: leaf('statement-of-account', 'Statement of account', '/dashboard/finance/statement-of-account', FileText, { aliases: ['Statement of Account'] }),
};

const myActivity = () => group('my-activity', 'My activity', User, [L.vote, L.shop, L.myOrders, L.myReceipts, L.statement], { band: 'Me' });

const dashboard = (role) => ({ id: 'dashboard', label: 'Dashboard', icon: Home, path: ROLE_HOME_PATHS[role], exact: true });

const NAV_BY_ROLE = {
  ADMIN: [
    dashboard('ADMIN'),
    { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, path: '/dashboard/approvals', also: ['/dashboard/approval-requests/new'] },
    group('members', 'Members', Users, [L.people, L.positions, L.programs], { band: 'Manage' }),
    group('finance', 'Finance', financePillar.icon, [L.budgets, L.ledger, L.collections, L.studentAccounts, L.reports, L.forecast], { band: 'Manage' }),
    group('events-tasks', 'Events and tasks', eventsPillar.icon, [L.events, L.venues, L.planning, L.tasks, L.aiDelegation, L.checkIn], { band: 'Manage' }),
    group('voting', 'Voting', electionsPillar.icon, [L.elections, L.results], { band: 'Community' }),
    group('store', 'Store', merchandisePillar.icon, [L.inventory, L.orders, L.claimDesk], { band: 'Community' }),
    group('updates', 'Updates', communicationPillar.icon, [L.announcements, L.feed], { band: 'Community' }),
    group('records', 'Records', ShieldCheck, [L.compliance, L.grievances, L.clearanceSigning, L.auditLog], { band: 'Records' }),
    myActivity(),
  ],
  SBO_OFFICER: [
    dashboard('SBO_OFFICER'),
    group('events-tasks', 'Events and tasks', eventsPillar.icon, [L.checkIn, L.calendar, L.venues, L.myTasks, L.aiDelegation], { band: 'Manage' }),
    group('finance', 'Finance (view only)', financePillar.icon, [L.budgets, L.ledger, L.reports, L.forecast], { band: 'Manage' }),
    { id: 'members-fingerprints', label: 'Members and fingerprints', icon: Fingerprint, path: '/dashboard/admin/users', aliases: ['Participant Biometrics', 'Manage Users'], band: 'Manage' },
    group('voting', 'Voting', electionsPillar.icon, [L.candidates, L.voters, L.results], { band: 'Community' }),
    group('store', 'Store', merchandisePillar.icon, [L.orders, L.claimDesk], { band: 'Community' }),
    group('updates', 'Updates', communicationPillar.icon, [L.announcements, L.feed], { band: 'Community' }),
    { id: 'clearance-signing', label: 'Clearance signing', icon: ShieldCheck, path: '/dashboard/clearances', aliases: ['Clearances'], band: 'Records' },
    myActivity(),
  ],
  DEPARTMENT_HEAD: [
    dashboard('DEPARTMENT_HEAD'),
    { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, path: '/dashboard/department-head/approvals', also: ['/dashboard/approvals'] },
    { id: 'college-organizations', label: 'Organizations', icon: Building2, path: '/dashboard/department-head/organizations' },
    group('finance', 'Finance', financePillar.icon, [L.budgets, L.ledger, L.reports, L.forecast], { band: 'College view (read only)' }),
    { id: 'activity-calendar', label: 'Calendar', icon: CalendarDays, path: '/dashboard/events/activity-calendar', aliases: ['Activity Calendar'], band: 'College view (read only)' },
    { id: 'election-results', label: 'Election results', icon: ChartColumn, path: '/dashboard/elections/election-results', aliases: ['Results'], band: 'College view (read only)' },
    { id: 'view-announcements', label: 'Announcements', icon: Newspaper, path: '/dashboard/announcements/view-announcements', aliases: ['Announcements Feed'], band: 'College view (read only)' },
  ],
  STUDENT: [
    dashboard('STUDENT'),
    group('my-payments', 'My payments', financePillar.icon, [L.statement, { ...L.myReceipts, label: 'Receipts', aliases: ['My Receipts'] }]),
    group('events', 'Events', eventsPillar.icon, [leaf('activity-calendar', 'Events', '/dashboard/events/activity-calendar', CalendarDays, { aliases: ['Activity Calendar', 'Calendar'] })]),
    group('voting', 'Voting', electionsPillar.icon, [L.vote, L.results]),
    group('store', 'Store', merchandisePillar.icon, [L.shop, L.myOrders]),
    group('updates', 'Updates', communicationPillar.icon, [leaf('view-announcements', 'Announcements', '/dashboard/announcements/view-announcements', Newspaper, { aliases: ['Announcements Feed'] })]),
    group('support', 'Support', MessageSquare, [
      leaf('gov-my-clearance', 'My clearance', '/dashboard/my-clearance', SearchCheck),
      leaf('gov-my-grievances', 'My grievances', '/dashboard/my-grievances', MessageSquare, { aliases: ['My Grievances'] }),
    ]),
  ],
  SUPER_ADMIN: [
    dashboard('SUPER_ADMIN'),
    group('sao-organizations-group', 'Organizations', Building2, [
      leaf('sao-agency', 'Agency overview', '/dashboard/super-admin/agency', LayoutDashboard),
      leaf('sao-organizations', 'Registrations and organizations', '/dashboard/super-admin/organizations?status=pending', Store, { aliases: ['Organizations'] }),
      leaf('sao-admins', 'Administrators', '/dashboard/super-admin/admins', UsersRound),
      leaf('sao-colleges', 'Colleges', '/dashboard/super-admin/colleges', Building2),
    ]),
    group('sao-reviews', 'Reviews', ClipboardCheck, [
      leaf('sao-compliance', 'Compliance', '/dashboard/super-admin/compliance', ClipboardCheck),
      leaf('sao-venues', 'Venues', '/dashboard/super-admin/venues', MapPin),
      leaf('sao-grievances', 'Grievances', '/dashboard/super-admin/grievances', MessageSquare),
      leaf('sao-clearances', 'Clearances', '/dashboard/super-admin/clearances', ShieldCheck),
    ]),
    group('sao-updates', 'Updates', Megaphone, [
      leaf('sao-announcements', 'University announcements', '/dashboard/super-admin/announcements', Megaphone),
      leaf('sao-notifications', 'Notifications', '/dashboard/super-admin/notifications', Newspaper),
    ]),
    group('sao-setup', 'Setup and records', Settings, [
      leaf('sao-academic-years', 'Academic years', '/dashboard/super-admin/academic-years', CalendarDays, { aliases: ['Academic Years'] }),
      leaf('sao-audit-logs', 'Audit trail', '/dashboard/super-admin/audit-logs', History),
    ]),
  ],
};

// Every role shares the same footer: the account page and the page that ends the old orphan.
export const footerNav = [
  { id: 'profile', label: 'Profile', path: '/dashboard/profile', icon: User },
  { id: 'objectives', label: 'Study objectives', path: '/dashboard/objectives', icon: BookOpen },
];

// Pages that left the sidebar but stay reachable from the command palette. Paths that are now
// redirects carry the query the surviving page will read.
const DEMOTED_BY_ROLE = {
  ADMIN: [
    { id: 'activity-calendar', label: 'Activity calendar', path: '/dashboard/events/manage-events?view=calendar', section: 'Events and tasks', icon: CalendarDays, aliases: ['Calendar', 'Activity Calendar'] },
    { id: 'create-task', label: 'New task', path: '/dashboard/tasks/task-board?new=1', section: 'Events and tasks', icon: ListChecks, aliases: ['Create Task'] },
    { id: 'task-progress', label: 'Task progress', path: '/dashboard/tasks/task-board?view=progress', section: 'Events and tasks', icon: ChartColumn, aliases: ['Monitor Progress', 'Monitor Task Progress'] },
    { id: 'create-announcement', label: 'New announcement', path: '/dashboard/announcements/create-announcement', section: 'Updates', icon: Megaphone, aliases: ['Create Announcement'] },
    { id: 'submit-request', label: 'New request', path: '/dashboard/approval-requests/new', section: 'Approvals', icon: ClipboardCheck, aliases: ['Submit Request'] },
    { id: 'manage-candidates', label: 'Candidates', path: '/dashboard/elections/manage-candidates', section: 'Voting', icon: UsersRound, aliases: ['Manage Candidates'] },
    { id: 'manage-partylists', label: 'Party lists', path: '/dashboard/elections/manage-partylists', section: 'Voting', icon: Flag, aliases: ['Party Lists', 'Manage Party Lists'] },
  ],
  SBO_OFFICER: [
    { id: 'create-announcement', label: 'New announcement', path: '/dashboard/announcements/create-announcement', section: 'Updates', icon: Megaphone, aliases: ['Create Announcement'] },
    { id: 'submit-request', label: 'New request', path: '/dashboard/approval-requests/new', section: 'Updates', icon: ClipboardCheck, aliases: ['Submit Request'] },
  ],
};

export function getVisibleChildren(item) {
  return item.children || [];
}

export function resolveItemPath(item) {
  if (item.path) {
    return item.path;
  }

  return getVisibleChildren(item)[0]?.path || '/dashboard';
}

export function getNavForRole(role) {
  return NAV_BY_ROLE[role] || [];
}

// The clickable destinations of the sidebar: a group's children, or the row itself when it has none.
export function getNavLeaves(role) {
  return getNavForRole(role).flatMap((item) => (item.children ? item.children : [item]));
}

function splitTarget(target) {
  const [pathname, query = ''] = target.split('?');
  return { pathname, params: new URLSearchParams(query) };
}

function matchLength(item, pathname) {
  const targets = [item.path, ...(item.also || [])];
  let best = 0;
  targets.forEach((target) => {
    const base = splitTarget(target).pathname;
    const hit = pathname === base || (!item.exact && pathname.startsWith(`${base}/`));
    if (hit && base.length > best) best = base.length;
  });
  return best;
}

function queryMatches(item, params) {
  const wanted = [...splitTarget(item.path).params.entries()];
  return wanted.length > 0 && wanted.every(([key, value]) => params.get(key) === value);
}

// Which one item is current: the longest matching path wins, and several items on one path are told
// apart by their query. An item with a query stays current on its own page even when the page has
// since changed the query, as long as nothing else on that path claims the location.
export function findActiveNavId(items, pathname, search = '') {
  const matches = items
    .map((item) => ({ item, length: matchLength(item, pathname) }))
    .filter((entry) => entry.length > 0);
  if (matches.length === 0) return null;

  const longest = Math.max(...matches.map((entry) => entry.length));
  const candidates = matches.filter((entry) => entry.length === longest).map((entry) => entry.item);
  if (candidates.length === 1) return candidates[0].id;

  const params = new URLSearchParams(search);
  const byQuery = candidates.filter((item) => queryMatches(item, params));
  if (byQuery.length > 0) return byQuery[0].id;

  return (candidates.find((item) => !item.path.includes('?')) || candidates[0]).id;
}

// Flattens the role's nav into individual pages for the command palette: leaf pages where a group
// has children, the row itself otherwise, then the footer and the demoted pages that left the menu.
export function getFlatPages(role) {
  const pages = [];

  getNavForRole(role).forEach((item) => {
    const children = getVisibleChildren(item);
    if (children.length > 0) {
      children.forEach((child) => {
        pages.push({ id: child.id, label: child.label, path: child.path, section: item.label, icon: child.icon || item.icon || Home, aliases: child.aliases || [] });
      });
      return;
    }

    pages.push({ id: item.id, label: item.label, path: resolveItemPath(item), section: item.label, icon: item.icon || Home, aliases: item.aliases || [] });
  });

  (DEMOTED_BY_ROLE[role] || []).forEach((page) => pages.push({ ...page, aliases: page.aliases || [] }));

  if (role in NAV_BY_ROLE) {
    footerNav.forEach((item) => {
      pages.push({ id: item.id, label: item.label, path: item.path, section: 'Account', icon: item.icon || Home, aliases: [] });
    });
  }

  return pages;
}
