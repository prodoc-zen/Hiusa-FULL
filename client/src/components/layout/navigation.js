import { Building2, ClipboardCheck, FileText, Home, ShieldCheck, Target, Users } from 'lucide-react';
import { PILLAR_BY_KEY } from '../../lib/pillars';

// Single source of truth for role-to-sidebar-sections. Sidebar.jsx renders this;
// CommandPalette.jsx flattens it for search. Keep every existing route/role pairing
// exactly as client/src/App.jsx allows it: a role only ever sees a link it can open.

export const ROLE_LABELS = {
  SUPER_ADMIN: 'SAO',
  ADMIN: 'Organization Admin',
  SBO_OFFICER: 'SBO Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

const financePillar = PILLAR_BY_KEY.finance;
const eventsPillar = PILLAR_BY_KEY.events;
const tasksPillar = PILLAR_BY_KEY.tasks;
const electionsPillar = PILLAR_BY_KEY.elections;
const merchandisePillar = PILLAR_BY_KEY.merchandise;
const communicationPillar = PILLAR_BY_KEY.communication;

export const NAV_STRUCTURE = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: Home,
    caption: 'Overview',
    rolePaths: {
      SUPER_ADMIN: '/dashboard/super-admin',
      ADMIN: '/dashboard/admin',
      SBO_OFFICER: '/dashboard/officer',
      DEPARTMENT_HEAD: '/dashboard/department-head',
      STUDENT: '/dashboard/student',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'],
  },
  {
    id: 'financial',
    label: 'Financial',
    icon: financePillar.icon,
    caption: `${financePillar.label} · ${financePillar.objectiveCode}`,
    roles: ['SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD', 'STUDENT'],
    children: [
      { id: 'financial-ledger', label: 'Financial Oversight', path: '/dashboard/finance/financial-ledger', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] },
      { id: 'collections', label: 'Collections & Advances', path: '/dashboard/finance/collections', roles: ['ADMIN'] },
      { id: 'student-accounts', label: 'Student Financial Accounts', path: '/dashboard/finance/student-accounts', roles: ['ADMIN'] },
      { id: 'budget-allocation', label: 'Budget Allocation', path: '/dashboard/finance/budget-allocation', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] },
      { id: 'financial-insights', label: 'Financial Insights', path: '/dashboard/finance/financial-insights', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] },
      { id: 'transaction-history', label: 'Transaction History', path: '/dashboard/finance/transaction-history', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] },
      { id: 'personal-receipts', label: 'My Receipts', path: '/dashboard/finance/personal-receipts', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'] },
      { id: 'statement-of-account', label: 'Statement of Account', path: '/dashboard/finance/statement-of-account', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'] },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    icon: eventsPillar.icon,
    caption: `${eventsPillar.label} · ${eventsPillar.objectiveCode}`,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT', 'DEPARTMENT_HEAD'],
    children: [
      { id: 'manage-events', label: 'Manage Events', path: '/dashboard/events/manage-events', roles: ['ADMIN'] },
      { id: 'event-planner', label: 'Event Planner', path: '/dashboard/events/event-planner', roles: ['ADMIN'] },
      { id: 'check-in', label: 'Check In', path: '/dashboard/events/check-in', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'activity-calendar', label: 'Activity Calendar', path: '/dashboard/events/activity-calendar', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT', 'DEPARTMENT_HEAD'] },
    ],
  },
  {
    id: 'tasks',
    label: 'Task Management',
    icon: tasksPillar.icon,
    caption: `${tasksPillar.label} · ${tasksPillar.objectiveCode}`,
    roles: ['SBO_OFFICER', 'ADMIN'],
    children: [
      { id: 'task-board', label: 'Task Board', path: '/dashboard/tasks/task-board', roles: ['ADMIN'] },
      { id: 'create-task', label: 'Create Task', path: '/dashboard/tasks/create-task', roles: ['ADMIN'] },
      { id: 'assigned-tasks', label: 'Assigned Tasks', path: '/dashboard/tasks/assigned-tasks', roles: ['SBO_OFFICER'] },
      { id: 'task-progress', label: 'Monitor Progress', path: '/dashboard/tasks/task-progress', roles: ['ADMIN'] },
      { id: 'ai-delegation', label: 'AI Delegation', path: '/dashboard/tasks/ai-delegation', roles: ['SBO_OFFICER', 'ADMIN'] },
    ],
  },
  {
    id: 'elections',
    label: 'Elections',
    icon: electionsPillar.icon,
    caption: `${electionsPillar.label} · ${electionsPillar.objectiveCode}`,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT', 'DEPARTMENT_HEAD'],
    children: [
      { id: 'manage-elections', label: 'Election Workspace', path: '/dashboard/elections/manage-elections', roles: ['ADMIN'] },
      { id: 'manage-candidates', label: 'Candidates', path: '/dashboard/elections/manage-candidates', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'manage-voters', label: 'Voters', path: '/dashboard/elections/manage-voters', roles: ['SBO_OFFICER'] },
      { id: 'manage-partylists', label: 'Party Lists', path: '/dashboard/elections/manage-partylists', roles: ['ADMIN'] },
      { id: 'cast-vote', label: 'Cast Vote', path: '/dashboard/elections/cast-vote', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
      { id: 'election-results', label: 'Results', path: '/dashboard/elections/election-results', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
    ],
  },
  {
    id: 'merchandise',
    label: 'Merchandise',
    icon: merchandisePillar.icon,
    caption: `${merchandisePillar.label} · ${merchandisePillar.objectiveCode}`,
    roles: ['SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD', 'STUDENT'],
    children: [
      { id: 'manage-inventory', label: 'Inventory', path: '/dashboard/merchandise/manage-inventory', roles: ['ADMIN'] },
      { id: 'manage-orders', label: 'Manage Orders', path: '/dashboard/merchandise/manage-orders', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'claim-tokens', label: 'Validate Tokens', path: '/dashboard/merchandise/claim-tokens', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'order-merchandise', label: 'Order Merchandise', path: '/dashboard/merchandise/order-merchandise', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
      { id: 'my-orders', label: 'My Orders', path: '/dashboard/merchandise/my-orders', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
    ],
  },
  {
    id: 'announcements',
    label: 'Announcements',
    icon: communicationPillar.icon,
    caption: `Communication · ${communicationPillar.objectiveCode}`,
    roles: ['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'],
    children: [
      { id: 'manage-announcements', label: 'Manage', path: '/dashboard/announcements/manage-announcements', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'create-announcement', label: 'Create', path: '/dashboard/announcements/create-announcement', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'view-announcements', label: 'View Feed', path: '/dashboard/announcements/view-announcements', roles: ['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] },
    ],
  },
  {
    id: 'users',
    label: 'Users & Positions',
    icon: Users,
    roles: ['ADMIN', 'SBO_OFFICER'],
    children: [
      { id: 'manage-users', label: 'Manage Users', path: '/dashboard/admin/users', roles: ['ADMIN'] },
      { id: 'participant-biometrics', label: 'Participant Biometrics', path: '/dashboard/admin/users', roles: ['SBO_OFFICER'] },
      { id: 'manage-positions', label: 'Manage Positions', path: '/dashboard/admin/positions', roles: ['ADMIN'] },
      { id: 'manage-programs-sections', label: 'Programs & Sections', path: '/dashboard/admin/programs-sections', roles: ['ADMIN'] },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: ClipboardCheck,
    rolePaths: {
      ADMIN: '/dashboard/approvals',
      DEPARTMENT_HEAD: '/dashboard/department-head/approvals',
    },
    roles: ['ADMIN', 'DEPARTMENT_HEAD'],
  },
  { id: 'submit-request', label: 'Submit Request', icon: ClipboardCheck, path: '/dashboard/approval-requests/new', roles: ['ADMIN', 'SBO_OFFICER'] },
  { id: 'audit-logs', label: 'General Audit Log', icon: ClipboardCheck, path: '/dashboard/audit-logs', roles: ['ADMIN'] },
  {
    id: 'governance',
    label: 'Governance',
    icon: ShieldCheck,
    roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'],
    children: [
      { id: 'gov-compliance', label: 'Compliance', path: '/dashboard/compliance', roles: ['ADMIN'] },
      { id: 'gov-venues', label: 'Venues', path: '/dashboard/venues', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'gov-grievances', label: 'Grievances', path: '/dashboard/grievances', roles: ['ADMIN'] },
      { id: 'gov-my-grievances', label: 'My Grievances', path: '/dashboard/my-grievances', roles: ['STUDENT'] },
      { id: 'gov-clearances', label: 'Clearances', path: '/dashboard/clearances', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'gov-my-clearance', label: 'My Clearance', path: '/dashboard/my-clearance', roles: ['STUDENT'] },
      { id: 'gov-evaluation', label: 'Evaluation', path: '/dashboard/evaluation', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
    ],
  },
  { id: 'study-objectives', label: 'Study Objectives', icon: Target, path: '/dashboard/objectives', roles: ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
];

export const GOVERNANCE_IDS = new Set(['users', 'approvals', 'submit-request', 'audit-logs', 'sao-administration', 'governance', 'study-objectives']);

export const profileNav = [
  { id: 'profile', label: 'Profile', path: '/dashboard/profile', icon: Users },
];

const studyObjectivesItem = NAV_STRUCTURE.find((item) => item.id === 'study-objectives');

export const SUPER_ADMIN_NAV = [
  NAV_STRUCTURE[0],
  {
    id: 'sao-administration',
    label: 'SAO Administration',
    icon: ShieldCheck,
    roles: ['SUPER_ADMIN'],
    children: [
      { id: 'sao-organizations', label: 'Organizations', path: '/dashboard/super-admin/organizations', roles: ['SUPER_ADMIN'] },
      { id: 'sao-colleges', label: 'Colleges', path: '/dashboard/super-admin/colleges', roles: ['SUPER_ADMIN'], icon: Building2 },
      { id: 'sao-event-requirements', label: 'Event Requirements', path: '/dashboard/super-admin/event-requirements', roles: ['SUPER_ADMIN'], icon: FileText },
      { id: 'sao-admins', label: 'Administrators', path: '/dashboard/super-admin/admins', roles: ['SUPER_ADMIN'] },
      { id: 'sao-compliance', label: 'Compliance', path: '/dashboard/super-admin/compliance', roles: ['SUPER_ADMIN'] },
      { id: 'sao-venues', label: 'Venues', path: '/dashboard/super-admin/venues', roles: ['SUPER_ADMIN'] },
      { id: 'sao-grievances', label: 'Grievances', path: '/dashboard/super-admin/grievances', roles: ['SUPER_ADMIN'] },
      { id: 'sao-clearances', label: 'Clearances', path: '/dashboard/super-admin/clearances', roles: ['SUPER_ADMIN'] },
      { id: 'sao-evaluation', label: 'Evaluation', path: '/dashboard/super-admin/evaluation', roles: ['SUPER_ADMIN'] },
      { id: 'sao-audit-logs', label: 'Audit Trail', path: '/dashboard/super-admin/audit-logs', roles: ['SUPER_ADMIN'] },
      { id: 'sao-announcements', label: 'University Announcements', path: '/dashboard/super-admin/announcements', roles: ['SUPER_ADMIN'] },
      { id: 'sao-financial-reports', label: 'Received Reports', path: '/dashboard/super-admin/financial-reports', roles: ['SUPER_ADMIN'], icon: FileText },
      { id: 'sao-notifications', label: 'Notifications', path: '/dashboard/super-admin/notifications', roles: ['SUPER_ADMIN'] },
    ],
  },
  studyObjectivesItem,
];

export function getVisibleChildren(item, role) {
  return (item.children || []).filter((child) => child.roles.includes(role));
}

export function resolveItemPath(item, role) {
  if (item.rolePaths) {
    return item.rolePaths[role] || item.rolePaths.SBO_OFFICER;
  }

  if (item.path) {
    return item.path;
  }

  const children = getVisibleChildren(item, role);
  return children[0]?.path || '/dashboard';
}

export function getNavForRole(role) {
  return role === 'SUPER_ADMIN' ? SUPER_ADMIN_NAV : NAV_STRUCTURE.filter((item) => item.roles.includes(role));
}

// Flattens the role's nav into individual pages for the command palette: leaf pages
// where a group has children, the group's own destination otherwise.
export function getFlatPages(role) {
  const source = getNavForRole(role);
  const pages = [];

  source.forEach((item) => {
    const visibleChildren = getVisibleChildren(item, role);
    if (visibleChildren.length > 0) {
      visibleChildren.forEach((child) => {
        pages.push({ id: child.id, label: child.label, path: child.path, section: item.label, icon: item.icon || Home });
      });
      return;
    }

    const path = resolveItemPath(item, role);
    pages.push({ id: item.id, label: item.label, path, section: item.caption || item.label, icon: item.icon || Home });
  });

  profileNav.forEach((item) => {
    pages.push({ id: item.id, label: item.label, path: item.path, section: 'Account', icon: item.icon || Home });
  });

  return pages;
}
