import { expect, test } from '@playwright/test';
import { BY_ROLE, PSITS_ORGANIZATION_ID } from './support/accounts.js';
import { liveEnabled, sessionFor } from './support/live.js';

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

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

// Pages that only redirect are listed in the redirect test below, with their target. The sidebar
// and these paths follow docs/UX_FLOW.md section 3.
const ROUTES = {
  SUPER_ADMIN: [
    '/dashboard/super-admin',
    '/dashboard/super-admin/agency',
    '/dashboard/super-admin/organizations',
    `/dashboard/super-admin/organizations/${PSITS_ORGANIZATION_ID}`,
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
    '/dashboard/profile',
  ],
  ADMIN: [
    '/dashboard/admin',
    '/dashboard/admin/users',
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
    '/dashboard/tasks/ai-delegation',
    '/dashboard/compliance',
    '/dashboard/venues',
    '/dashboard/grievances',
    '/dashboard/clearances',
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
    '/dashboard/announcements/view-announcements',
    '/dashboard/events/activity-calendar',
    '/dashboard/finance/financial-ledger',
    '/dashboard/finance/budget-allocation',
    '/dashboard/finance/financial-insights',
    '/dashboard/finance/transaction-history',
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
    '/dashboard/profile',
    '/dashboard/elections/cast-vote',
    '/dashboard/elections/election-results',
  ],
};

async function signIn(page, role) {
  const session = await sessionFor(BY_ROLE[role]);
  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    // The elections hub shows a picker until an election is chosen; pre-select the
    // seeded one so the election sub-pages render their real content.
    const selectionKey = `hiusa-election-${user?.organization_id ?? 'organization'}-${user?.school_id ?? 'user'}`;
    window.sessionStorage.setItem(selectionKey, '1');
    window.sessionStorage.setItem('activeElectionId', '1');
  }, session);
  return session;
}

for (const role of Object.keys(ROUTES)) {
  test(`${role} can open every authorized page`, async ({ page }) => {
    // Each test walks every page for one role, so it needs far more than the
    // 30s default; without this the browser context closes mid-walk and the
    // remaining routes report spurious "browser has been closed" failures.
    test.setTimeout(600_000);
    await signIn(page, role);
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

test('removed and redirected routes resolve where they should', async ({ page }) => {
  test.setTimeout(240_000);
  const byRole = {
    SUPER_ADMIN: {
      '/dashboard/super-admin/financial-reports': /\/dashboard\/super-admin\/compliance\?tab=financial$/,
      '/dashboard/super-admin/approvals': /\/dashboard\/super-admin\/compliance\?tab=financial$/,
      '/dashboard/super-admin/event-requirements': /\/dashboard\/super-admin\/compliance\?tab=events$/,
    },
    // The Admin's old pages merged into surviving ones; the query tells the survivor which view to open.
    ADMIN: {
      '/dashboard/events/activity-calendar': /\/dashboard\/events\/manage-events\?view=calendar$/,
      '/dashboard/tasks/create-task': /\/dashboard\/tasks\/task-board\?new=1$/,
      '/dashboard/tasks/task-progress': /\/dashboard\/tasks\/task-board\?view=progress$/,
      '/dashboard/admin/sbo-positions': /\/dashboard\/admin\/positions$/,
      '/dashboard/events/event-operations': /\/dashboard\/events\/check-in$/,
      '/dashboard/merchandise/gcash-payment': /\/dashboard\/merchandise\/manage-orders$/,
    },
    // A Department Head has one Approvals route.
    DEPARTMENT_HEAD: {
      '/dashboard/approvals': /\/dashboard\/department-head\/approvals$/,
    },
  };
  for (const [role, redirects] of Object.entries(byRole)) {
    const context = await page.context().browser().newContext();
    const rolePage = await context.newPage();
    await signIn(rolePage, role);
    for (const [from, to] of Object.entries(redirects)) {
      await rolePage.goto(from, { waitUntil: 'domcontentloaded' });
      await expect(rolePage, `${role} ${from}`).toHaveURL(to);
      await expect(rolePage.getByRole('main')).toBeVisible({ timeout: 15000 });
    }
    await context.close();
  }
});

test('DEPARTMENT_HEAD is turned away from voting and merchandise', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'DEPARTMENT_HEAD');
  for (const path of ['/dashboard/elections/cast-vote', '/dashboard/merchandise/my-orders', '/dashboard/merchandise/order-merchandise', '/dashboard/merchandise/manage-orders']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname, `${path} must not render for a Department Head`).not.toBe(path);
  }
});

test('STUDENT cannot open SAO or Department Head pages', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'STUDENT');
  for (const path of ['/dashboard/super-admin/agency', `/dashboard/super-admin/organizations/${PSITS_ORGANIZATION_ID}`, '/dashboard/department-head/organizations']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname, `${path} must bounce a Student`).toBe('/dashboard/student');
  }
  await page.goto('/dashboard/merchandise/claim-tokens', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/dashboard\/merchandise\/my-orders$/);
});
