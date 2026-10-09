import { describe, expect, it } from 'vitest';
import { dashboardRoutes, roleCanOpen } from '../../test/appRoutes';
import { findActiveNavId, footerNav, getFlatPages, getNavForRole, getNavLeaves, getVisibleChildren, resolveItemPath } from './navigation';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

const FINANCE_MANAGER_LEAVES = [
  ['Budgets', '/dashboard/finance/budget-allocation'],
  ['Ledger', '/dashboard/finance/financial-ledger'],
  ['Financial reports', '/dashboard/finance/transaction-history'],
  ['Forecast', '/dashboard/finance/financial-insights'],
];

const MY_ACTIVITY_LEAVES = [
  ['Vote', '/dashboard/elections/cast-vote'],
  ['Shop', '/dashboard/merchandise/order-merchandise'],
  ['My orders', '/dashboard/merchandise/my-orders'],
  ['My receipts', '/dashboard/finance/personal-receipts'],
  ['Statement of account', '/dashboard/finance/statement-of-account'],
];

// docs/UX_FLOW.md section 3.2, written out by hand so the menu cannot drift from the spec unnoticed.
const SPEC = {
  ADMIN: [
    { label: 'Dashboard', path: '/dashboard/admin' },
    { label: 'Approvals', path: '/dashboard/approvals' },
    { band: 'Manage', label: 'Members', children: [['People', '/dashboard/admin/users'], ['Officer positions', '/dashboard/admin/positions'], ['Programs and sections', '/dashboard/admin/programs-sections']] },
    {
      band: 'Manage',
      label: 'Finance',
      children: [
        ['Budgets', '/dashboard/finance/budget-allocation'],
        ['Ledger', '/dashboard/finance/financial-ledger'],
        ['Collections and advances', '/dashboard/finance/collections'],
        ['Student accounts', '/dashboard/finance/student-accounts'],
        ['Financial reports', '/dashboard/finance/transaction-history'],
        ['Forecast', '/dashboard/finance/financial-insights'],
      ],
    },
    {
      band: 'Manage',
      label: 'Events and tasks',
      children: [
        ['Events', '/dashboard/events/manage-events'],
        ['Venue booking', '/dashboard/venues'],
        ['Planning', '/dashboard/events/event-planner'],
        ['Tasks', '/dashboard/tasks/task-board'],
        ['AI delegation', '/dashboard/tasks/ai-delegation'],
        ['Check-in', '/dashboard/events/check-in'],
      ],
    },
    { band: 'Community', label: 'Voting', children: [['Elections', '/dashboard/elections/manage-elections'], ['Results', '/dashboard/elections/election-results']] },
    { band: 'Community', label: 'Store', children: [['Inventory', '/dashboard/merchandise/manage-inventory'], ['Orders', '/dashboard/merchandise/manage-orders'], ['Claim desk', '/dashboard/merchandise/claim-tokens']] },
    { band: 'Community', label: 'Updates', children: [['Announcements', '/dashboard/announcements/manage-announcements'], ['Feed', '/dashboard/announcements/view-announcements']] },
    { band: 'Records', label: 'Records', children: [['Compliance', '/dashboard/compliance'], ['Grievances', '/dashboard/grievances'], ['Clearance signing', '/dashboard/clearances'], ['Audit log', '/dashboard/audit-logs']] },
    { band: 'Me', label: 'My activity', children: MY_ACTIVITY_LEAVES },
  ],
  SBO_OFFICER: [
    { label: 'Dashboard', path: '/dashboard/officer' },
    {
      band: 'Manage',
      label: 'Events and tasks',
      children: [
        ['Check-in', '/dashboard/events/check-in'],
        ['Calendar', '/dashboard/events/activity-calendar'],
        ['Venue booking', '/dashboard/venues'],
        ['My tasks', '/dashboard/tasks/assigned-tasks'],
        ['AI delegation', '/dashboard/tasks/ai-delegation'],
      ],
    },
    { band: 'Manage', label: 'Finance (view only)', children: FINANCE_MANAGER_LEAVES },
    { band: 'Manage', label: 'Members and fingerprints', path: '/dashboard/admin/users' },
    { band: 'Community', label: 'Voting', children: [['Candidates', '/dashboard/elections/manage-candidates'], ['Voters', '/dashboard/elections/manage-voters'], ['Results', '/dashboard/elections/election-results']] },
    { band: 'Community', label: 'Store', children: [['Orders', '/dashboard/merchandise/manage-orders'], ['Claim desk', '/dashboard/merchandise/claim-tokens']] },
    { band: 'Community', label: 'Updates', children: [['Announcements', '/dashboard/announcements/manage-announcements'], ['Feed', '/dashboard/announcements/view-announcements']] },
    { band: 'Records', label: 'Clearance signing', path: '/dashboard/clearances' },
    { band: 'Me', label: 'My activity', children: MY_ACTIVITY_LEAVES },
  ],
  DEPARTMENT_HEAD: [
    { label: 'Dashboard', path: '/dashboard/department-head' },
    { label: 'Approvals', path: '/dashboard/department-head/approvals' },
    { label: 'Organizations', path: '/dashboard/department-head/organizations' },
    { band: 'College view (read only)', label: 'Finance', children: FINANCE_MANAGER_LEAVES },
    { band: 'College view (read only)', label: 'Calendar', path: '/dashboard/events/activity-calendar' },
    { band: 'College view (read only)', label: 'Election results', path: '/dashboard/elections/election-results' },
    { band: 'College view (read only)', label: 'Announcements', path: '/dashboard/announcements/view-announcements' },
  ],
  STUDENT: [
    { label: 'Dashboard', path: '/dashboard/student' },
    { label: 'My payments', children: [['Statement of account', '/dashboard/finance/statement-of-account'], ['Receipts', '/dashboard/finance/personal-receipts']] },
    { label: 'Events', children: [['Events', '/dashboard/events/activity-calendar']] },
    { label: 'Voting', children: [['Vote', '/dashboard/elections/cast-vote'], ['Results', '/dashboard/elections/election-results']] },
    { label: 'Store', children: [['Shop', '/dashboard/merchandise/order-merchandise'], ['My orders', '/dashboard/merchandise/my-orders']] },
    { label: 'Updates', children: [['Announcements', '/dashboard/announcements/view-announcements']] },
    { label: 'Support', children: [['My clearance', '/dashboard/my-clearance'], ['My grievances', '/dashboard/my-grievances']] },
  ],
  SUPER_ADMIN: [
    { label: 'Dashboard', path: '/dashboard/super-admin' },
    {
      label: 'Organizations',
      children: [
        ['Agency overview', '/dashboard/super-admin/agency'],
        ['Registrations and organizations', '/dashboard/super-admin/organizations?status=pending'],
        ['Administrators', '/dashboard/super-admin/admins'],
        ['Colleges', '/dashboard/super-admin/colleges'],
      ],
    },
    {
      label: 'Reviews',
      children: [
        ['Compliance', '/dashboard/super-admin/compliance'],
        ['Venues', '/dashboard/super-admin/venues'],
        ['Grievances', '/dashboard/super-admin/grievances'],
        ['Clearances', '/dashboard/super-admin/clearances'],
      ],
    },
    { label: 'Updates', children: [['University announcements', '/dashboard/super-admin/announcements'], ['Notifications', '/dashboard/super-admin/notifications']] },
    { label: 'Setup and records', children: [['Academic years', '/dashboard/super-admin/academic-years'], ['Audit trail', '/dashboard/super-admin/audit-logs']] },
  ],
};

function outline(role) {
  return getNavForRole(role).map((item) => {
    const row = item.band ? { band: item.band } : {};
    row.label = item.label;
    if (item.children) row.children = item.children.map((child) => [child.label, child.path]);
    else row.path = item.path;
    return row;
  });
}

describe('sidebar per role, against docs/UX_FLOW.md section 3.2', () => {
  it.each(ROLES)('lists the rows, bands, labels and routes of %s in order', (role) => {
    expect(outline(role)).toEqual(SPEC[role]);
  });

  it.each([
    ['ADMIN', 10, 33],
    ['SBO_OFFICER', 9, 24],
    ['DEPARTMENT_HEAD', 7, 10],
    ['STUDENT', 7, 11],
    ['SUPER_ADMIN', 5, 13],
  ])('%s has %i rows and %i leaves, as the spec counts them', (role, rows, leaves) => {
    expect(getNavForRole(role)).toHaveLength(rows);
    expect(getNavLeaves(role)).toHaveLength(leaves);
  });

  it('gives every role a Dashboard row that opens its own home', () => {
    for (const role of ROLES) {
      const [first] = getNavForRole(role);
      expect(first.label).toBe('Dashboard');
      expect(resolveItemPath(first)).toBe(SPEC[role][0].path);
    }
  });

  it('shares the footer: Profile, then the Study objectives link that ends the orphan page', () => {
    expect(footerNav.map((item) => [item.label, item.path])).toEqual([
      ['Profile', '/dashboard/profile'],
      ['Study objectives', '/dashboard/objectives'],
    ]);
  });

  it('opens a group on its first page', () => {
    const group = getNavForRole('SUPER_ADMIN')[1];
    expect(resolveItemPath(group)).toBe('/dashboard/super-admin/agency');
    expect(getVisibleChildren(group)).toHaveLength(4);
  });

  it('names the SAO and the finance slot the same way everywhere', () => {
    const labels = ROLES.flatMap((role) => getFlatPages(role).flatMap((page) => [page.label, page.section]));
    expect(labels.some((label) => /super admin|student affairs/i.test(label))).toBe(false);
    expect(getNavForRole('ADMIN').some((item) => item.label === 'Finance')).toBe(true);
    expect(getNavForRole('STUDENT').some((item) => item.label === 'My payments')).toBe(true);
  });

  it('has unique ids inside each role so one item is highlighted', () => {
    for (const role of ROLES) {
      const ids = [...getNavLeaves(role), ...footerNav].map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('menu links against the route guards in App.jsx', () => {
  const routes = dashboardRoutes();

  it.each(ROLES)('shows %s only links its ProtectedRoute lets it open', (role) => {
    const pages = getFlatPages(role);
    for (const page of pages) {
      const pathname = page.path.split('?')[0];
      const route = routes.find((candidate) => candidate.path === pathname);
      expect(route, `${role}: ${page.label} points at ${pathname}, which is not a route in App.jsx`).toBeDefined();
      expect(roleCanOpen(route, role), `${role} is not allowed to open ${pathname} (${page.label})`).toBe(true);
    }
  });
});

describe('command palette pages', () => {
  it.each(ROLES)('lists every sidebar route of %s, so nothing in the menu is unsearchable', (role) => {
    const paths = getFlatPages(role).map((page) => page.path);
    SPEC[role].forEach((row) => {
      (row.children ? row.children.map(([, path]) => path) : [row.path]).forEach((path) => expect(paths).toContain(path));
    });
    expect(paths).toContain('/dashboard/profile');
    expect(paths).toContain('/dashboard/objectives');
  });

  it('keeps pages that left the Admin menu reachable, under old and new names', () => {
    const pages = getFlatPages('ADMIN');
    const byAlias = (alias) => pages.find((page) => page.aliases.includes(alias));
    expect(byAlias('Create Task')?.path).toBe('/dashboard/tasks/task-board?new=1');
    expect(byAlias('Monitor Progress')?.path).toBe('/dashboard/tasks/task-board?view=progress');
    expect(byAlias('Activity Calendar')?.path).toBe('/dashboard/events/manage-events?view=calendar');
    expect(byAlias('Create Announcement')?.path).toBe('/dashboard/announcements/create-announcement');
    expect(byAlias('Submit Request')?.path).toBe('/dashboard/approval-requests/new');
    expect(byAlias('Manage Candidates')?.path).toBe('/dashboard/elections/manage-candidates');
    expect(byAlias('Party Lists')?.path).toBe('/dashboard/elections/manage-partylists');
  });

  it('keeps the old label of a renamed page as a search alias', () => {
    const pages = getFlatPages('ADMIN');
    const find = (id) => pages.find((page) => page.id === id);
    expect(find('financial-ledger').aliases).toContain('Digital Ledger');
    expect(find('transaction-history').aliases).toContain('Transaction History');
    expect(find('claim-tokens').aliases).toEqual(expect.arrayContaining(['Validate Tokens', 'Claim Tokens']));
    expect(find('manage-users').aliases).toContain('Manage Users');
  });

  it('does not offer a page the role cannot open', () => {
    expect(getFlatPages('STUDENT').some((page) => page.path.includes('/admin/'))).toBe(false);
    expect(getFlatPages('DEPARTMENT_HEAD').some((page) => page.path.includes('cast-vote') || page.path.includes('/merchandise'))).toBe(false);
    expect(getFlatPages('SUPER_ADMIN').every((page) => page.path.startsWith('/dashboard/super-admin') || page.path === '/dashboard/profile' || page.path === '/dashboard/objectives')).toBe(true);
  });

  it.each(ROLES)('omits Evaluation from navigation and search for %s', (role) => {
    expect(getFlatPages(role).some((item) => item.path.includes('evaluation'))).toBe(false);
  });
});

describe('active item', () => {
  const items = [
    { id: 'home', path: '/dashboard/super-admin', exact: true },
    { id: 'pending', path: '/dashboard/super-admin/organizations?status=pending' },
    { id: 'all', path: '/dashboard/super-admin/organizations' },
    { id: 'agency', path: '/dashboard/super-admin/agency' },
  ];

  it('picks the item whose query the location carries', () => {
    expect(findActiveNavId(items, '/dashboard/super-admin/organizations', '?status=pending')).toBe('pending');
    expect(findActiveNavId(items, '/dashboard/super-admin/organizations', '')).toBe('all');
    expect(findActiveNavId(items, '/dashboard/super-admin/organizations', '?status=returned')).toBe('all');
  });

  it('keeps a lone item with a query active when the page changes the query', () => {
    const [home, pending] = items;
    expect(findActiveNavId([home, pending], '/dashboard/super-admin/organizations', '?status=active')).toBe('pending');
  });

  it('matches a record under the item and never lets Dashboard swallow sub-pages', () => {
    expect(findActiveNavId(items, '/dashboard/super-admin/organizations/7', '')).toBe('all');
    expect(findActiveNavId(items, '/dashboard/super-admin/agency', '')).toBe('agency');
    expect(findActiveNavId(items, '/dashboard/super-admin', '')).toBe('home');
    expect(findActiveNavId(items, '/dashboard/elsewhere', '')).toBeNull();
  });

  it('keeps the hub highlighted on its steps and the demoted pages on their parent', () => {
    const admin = getNavLeaves('ADMIN');
    expect(findActiveNavId(admin, '/dashboard/elections/manage-partylists')).toBe('manage-elections');
    expect(findActiveNavId(admin, '/dashboard/elections/manage-candidates')).toBe('manage-elections');
    expect(findActiveNavId(admin, '/dashboard/announcements/create-announcement')).toBe('manage-announcements');
    expect(findActiveNavId(admin, '/dashboard/tasks/create-task')).toBe('task-board');
    expect(findActiveNavId(admin, '/dashboard/admin/sbo-positions')).toBe('manage-positions');
    expect(findActiveNavId(getNavLeaves('DEPARTMENT_HEAD'), '/dashboard/approvals')).toBe('approvals');
  });
});
