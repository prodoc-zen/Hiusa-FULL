import { expect, test } from '@playwright/test';
import process from 'node:process';

// Every authorized page, per role, is opened in a real browser and checked for
// three things: the app shell stays mounted (a page component that throws with no
// error boundary would blank the whole tree), the main landmark renders a heading,
// and the URL is retained (an unauthorized redirect or a dead route would change
// it). This is the "every page loads" guard behind the claim that the app is
// functional. It runs against the seeded local Laravel API.
//
// The route lists mirror server/config/client_routes.php (which
// ClientRouteAllowlistTest keeps in step with App.jsx). Pages that only redirect
// (index redirects, event-operations, gcash-payment, the old SAO URLs) are not in
// the lists; the redirect and refusal tests at the bottom cover them instead.
//
// Set HIUSA_LIVE_E2E=1 to run it.

const apiUrl = process.env.HIUSA_E2E_API_URL || 'http://127.0.0.1:8000/api';
const liveEnabled = process.env.HIUSA_LIVE_E2E === '1';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const ACCOUNTS = {
  SUPER_ADMIN: { schoolId: 930027, password: 'Demo@12345', organizationId: 6 },
  ADMIN: { schoolId: 990001, password: 'Admin@123456', organizationId: 1 },
  SBO_OFFICER: { schoolId: 900004, password: 'Demo@12345', organizationId: 1 },
  DEPARTMENT_HEAD: { schoolId: 940001, password: 'Demo@12345', organizationId: 7 },
  STUDENT: { schoolId: 2100142, password: 'Demo@12345', organizationId: 1 },
};

const ROUTES = {
  SUPER_ADMIN: [
    '/dashboard/super-admin',
    '/dashboard/super-admin/agency',
    '/dashboard/super-admin/organizations',
    '/dashboard/super-admin/organizations/1',
    '/dashboard/super-admin/colleges',
    '/dashboard/super-admin/admins',
    '/dashboard/super-admin/announcements',
    '/dashboard/super-admin/notifications',
    '/dashboard/super-admin/compliance',
    '/dashboard/super-admin/venues',
    '/dashboard/super-admin/grievances',
    '/dashboard/super-admin/clearances',
    '/dashboard/super-admin/audit-logs',
    '/dashboard/super-admin/academic-years',
    '/dashboard/objectives',
    '/dashboard/profile',
  ],
  ADMIN: [
    '/dashboard/admin',
    '/dashboard/admin/users',
    '/dashboard/admin/sbo-positions',
    '/dashboard/admin/positions',
    '/dashboard/admin/programs-sections',
    '/dashboard/audit-logs',
    '/dashboard/approvals',
    '/dashboard/approval-requests/new',
    '/dashboard/approval-requests/new/announcement',
    '/dashboard/approval-requests/new/budget',
    '/dashboard/approval-requests/new/event',
    '/dashboard/approval-requests/new/election',
    '/dashboard/announcements/manage-announcements',
    '/dashboard/announcements/create-announcement',
    '/dashboard/announcements/view-announcements',
    '/dashboard/events/manage-events',
    '/dashboard/events/event-planner',
    '/dashboard/events/check-in',
    '/dashboard/events/activity-calendar',
    '/dashboard/finance/financial-ledger',
    '/dashboard/finance/collections',
    '/dashboard/finance/student-accounts',
    '/dashboard/finance/budget-allocation',
    '/dashboard/finance/financial-insights',
    '/dashboard/finance/transaction-history',
    '/dashboard/finance/personal-receipts',
    '/dashboard/finance/statement-of-account',
    '/dashboard/merchandise/manage-inventory',
    '/dashboard/merchandise/manage-orders',
    '/dashboard/merchandise/claim-tokens',
    '/dashboard/merchandise/order-merchandise',
    '/dashboard/merchandise/my-orders',
    '/dashboard/tasks/task-board',
    '/dashboard/tasks/create-task',
    '/dashboard/tasks/task-progress',
    '/dashboard/tasks/ai-delegation',
    '/dashboard/compliance',
    '/dashboard/venues',
    '/dashboard/grievances',
    '/dashboard/clearances',
    '/dashboard/objectives',
    '/dashboard/profile',
    '/dashboard/elections/manage-elections',
    '/dashboard/elections/manage-candidates',
    '/dashboard/elections/manage-partylists',
    '/dashboard/elections/cast-vote',
    '/dashboard/elections/election-results',
  ],
  SBO_OFFICER: [
    '/dashboard/officer',
    '/dashboard/approval-requests/new',
    '/dashboard/approval-requests/new/announcement',
    '/dashboard/admin/users',
    '/dashboard/announcements/manage-announcements',
    '/dashboard/announcements/create-announcement',
    '/dashboard/announcements/view-announcements',
    '/dashboard/events/check-in',
    '/dashboard/events/activity-calendar',
    '/dashboard/finance/financial-ledger',
    '/dashboard/finance/budget-allocation',
    '/dashboard/finance/financial-insights',
    '/dashboard/finance/transaction-history',
    '/dashboard/finance/personal-receipts',
    '/dashboard/finance/statement-of-account',
    '/dashboard/merchandise/manage-orders',
    '/dashboard/merchandise/claim-tokens',
    '/dashboard/merchandise/order-merchandise',
    '/dashboard/merchandise/my-orders',
    '/dashboard/tasks/assigned-tasks',
    '/dashboard/tasks/ai-delegation',
    '/dashboard/venues',
    '/dashboard/clearances',
    '/dashboard/objectives',
    '/dashboard/profile',
    '/dashboard/elections/manage-candidates',
    '/dashboard/elections/manage-voters',
    '/dashboard/elections/cast-vote',
    '/dashboard/elections/election-results',
  ],
  DEPARTMENT_HEAD: [
    '/dashboard/department-head',
    '/dashboard/department-head/approvals',
    '/dashboard/department-head/organizations',
    '/dashboard/approvals',
    '/dashboard/announcements/view-announcements',
    '/dashboard/events/activity-calendar',
    '/dashboard/finance/financial-ledger',
    '/dashboard/finance/budget-allocation',
    '/dashboard/finance/financial-insights',
    '/dashboard/finance/transaction-history',
    '/dashboard/objectives',
    '/dashboard/profile',
    '/dashboard/elections/election-results',
  ],
  STUDENT: [
    '/dashboard/student',
    '/dashboard/announcements/view-announcements',
    '/dashboard/events/activity-calendar',
    '/dashboard/finance/personal-receipts',
    '/dashboard/finance/statement-of-account',
    '/dashboard/merchandise/order-merchandise',
    '/dashboard/merchandise/my-orders',
    '/dashboard/my-grievances',
    '/dashboard/my-clearance',
    '/dashboard/objectives',
    '/dashboard/profile',
    '/dashboard/elections/cast-vote',
    '/dashboard/elections/election-results',
  ],
};

async function signIn(page, request, role) {
  const { schoolId, password, organizationId } = ACCOUNTS[role];
  const login = await request.post(`${apiUrl}/login`, { data: { organization_id: organizationId, school_id: schoolId, password } });
  await expect(login, `login failed for ${role} (${schoolId})`).toBeOK();
  const payload = await login.json();
  await page.addInitScript(({ token, user, organizationId: orgId }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('selected_organization', JSON.stringify({ id: orgId, name: 'HIUSA', acronym: 'HIUSA' }));
    // The elections hub shows a picker until an election is chosen; pre-select the
    // seeded one so the election sub-pages render their real content.
    window.sessionStorage.setItem('activeElectionId', '1');
  }, { token: payload.access_token, user: payload.user, organizationId });
  return payload;
}

for (const role of Object.keys(ROUTES)) {
  test(`${role} can open every authorized page`, async ({ page, request }) => {
    // Each test walks every page for one role, so it needs far more than the
    // 30s default; without this the browser context closes mid-walk and the
    // remaining routes report spurious "browser has been closed" failures.
    test.setTimeout(600_000);
    await signIn(page, request, role);
    const failures = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(`pageerror ${page.url()} ${String(error.message).slice(0, 160)}`));

    for (const path of ROUTES[role]) {
      try {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        // Shell mounted (a page crash with no error boundary blanks nav too).
        await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15000 });
        const main = page.getByRole('main');
        await expect(main).toBeVisible({ timeout: 15000 });
        // Page rendered real content (a heading, or substantial body text for the
        // few grid/card pages that carry no semantic heading), and did not surface
        // an error state.
        const heading = main.getByRole('heading').first();
        const hasHeading = await heading.isVisible().catch(() => false)
          || await heading.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
        const text = (await main.innerText().catch(() => '')).trim();
        if (!hasHeading && text.length < 40) {
          failures.push(`${path} -> no heading and near-empty main`);
        }
        if (/something went wrong|unexpected error occurred/i.test(text)) {
          failures.push(`${path} -> error state shown`);
        }
        // Authorized role kept on the page rather than bounced.
        const url = new URL(page.url());
        if (url.pathname !== path) {
          failures.push(`${path} -> redirected to ${url.pathname}`);
        }
      } catch (error) {
        failures.push(`${path} -> ${String(error.message).split('\n')[0]}`);
      }
    }

    console.log(`ROLE ${role}: ${ROUTES[role].length - failures.length}/${ROUTES[role].length} pages OK; uncaught page errors: ${consoleErrors.length}`);
    for (const line of consoleErrors) console.log(`  ${line}`);
    expect(failures, `Pages that did not render for ${role}:\n  ${failures.join('\n  ')}`).toEqual([]);
  });
}

test('removed and redirected routes resolve where they should', async ({ page, request }) => {
  test.setTimeout(180_000);
  await signIn(page, request, 'SUPER_ADMIN');
  const redirects = {
    '/dashboard/super-admin/financial-reports': /\/dashboard\/super-admin\/compliance\?tab=financial$/,
    '/dashboard/super-admin/approvals': /\/dashboard\/super-admin\/compliance\?tab=financial$/,
    '/dashboard/super-admin/event-requirements': /\/dashboard\/super-admin\/compliance\?tab=events$/,
  };
  for (const [from, to] of Object.entries(redirects)) {
    await page.goto(from, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(to);
  }
});

test('DEPARTMENT_HEAD is turned away from voting and merchandise', async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, request, 'DEPARTMENT_HEAD');
  for (const path of ['/dashboard/elections/cast-vote', '/dashboard/merchandise/my-orders', '/dashboard/merchandise/order-merchandise', '/dashboard/merchandise/manage-orders']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname, `${path} must not render for a Department Head`).not.toBe(path);
  }
});

test('STUDENT cannot open SAO or Department Head pages', async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, request, 'STUDENT');
  for (const path of ['/dashboard/super-admin/agency', '/dashboard/super-admin/organizations/1', '/dashboard/department-head/organizations']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname, `${path} must bounce a Student`).toBe('/dashboard/student');
  }
  await page.goto('/dashboard/merchandise/claim-tokens', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/dashboard\/merchandise\/my-orders$/);
});
