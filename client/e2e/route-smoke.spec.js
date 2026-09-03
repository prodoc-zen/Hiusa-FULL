import { expect, test } from '@playwright/test';
import process from 'node:process';

// Every authorized page, per role, is opened in a real browser and checked for
// three things: the app shell stays mounted (a page component that throws with no
// error boundary would blank the whole tree), the main landmark renders a heading,
// and the URL is retained (an unauthorized redirect or a dead route would change
// it). This is the "every page loads" guard behind the claim that the app is
// functional. It runs against the seeded local Laravel API.
//
// Set HIUSA_LIVE_E2E=1 to run it.

const apiUrl = process.env.HIUSA_E2E_API_URL || 'http://127.0.0.1:8000/api';
const liveEnabled = process.env.HIUSA_LIVE_E2E === '1';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const ACCOUNTS = {
  ADMIN: { schoolId: 990001, password: 'Admin@123456' },
  SBO_OFFICER: { schoolId: 900001, password: 'Demo@12345' },
  DEPARTMENT_HEAD: { schoolId: 940001, password: 'Demo@12345' },
  STUDENT: { schoolId: 2100142, password: 'Demo@12345' },
};

// Pages each role is allowed to open, mirrored from the route guards in App.jsx.
// Every leaf page in the app appears at least once here, under an authorized role.
const ROUTES = {
  ADMIN: [
    '/dashboard/admin',
    '/dashboard/admin/users',
    '/dashboard/admin/sbo-positions',
    '/dashboard/admin/programs-sections',
    '/dashboard/audit-logs',
    '/dashboard/approvals',
    '/dashboard/announcements/manage-announcements',
    '/dashboard/announcements/create-announcement',
    '/dashboard/announcements/view-announcements',
    '/dashboard/events/manage-events',
    '/dashboard/events/event-planner',
    '/dashboard/events/event-operations',
    '/dashboard/events/activity-calendar',
    '/dashboard/finance/financial-ledger',
    '/dashboard/finance/student-accounts',
    '/dashboard/finance/budget-allocation',
    '/dashboard/finance/financial-insights',
    '/dashboard/finance/transaction-history',
    '/dashboard/finance/personal-receipts',
    '/dashboard/finance/statement-of-account',
    '/dashboard/merchandise/manage-inventory',
    '/dashboard/merchandise/gcash-payment',
    '/dashboard/merchandise/manage-orders',
    '/dashboard/merchandise/claim-tokens',
    '/dashboard/merchandise/order-merchandise',
    '/dashboard/merchandise/my-orders',
    '/dashboard/tasks/task-board',
    '/dashboard/tasks/create-task',
    '/dashboard/tasks/task-progress',
    '/dashboard/tasks/ai-delegation',
    '/dashboard/profile',
    '/dashboard/elections/manage-elections',
    '/dashboard/elections/manage-candidates',
    '/dashboard/elections/manage-partylists',
    '/dashboard/elections/cast-vote',
    '/dashboard/elections/election-results',
  ],
  SBO_OFFICER: [
    '/dashboard/officer',
    '/dashboard/tasks/assigned-tasks',
    '/dashboard/tasks/ai-delegation',
    '/dashboard/elections/manage-candidates',
    '/dashboard/elections/manage-voters',
    '/dashboard/events/event-operations',
    '/dashboard/announcements/view-announcements',
    '/dashboard/merchandise/order-merchandise',
    '/dashboard/profile',
  ],
  DEPARTMENT_HEAD: [
    '/dashboard/department-head',
    '/dashboard/department-head/approvals',
    '/dashboard/approvals',
    '/dashboard/finance/transaction-history',
    '/dashboard/events/activity-calendar',
    '/dashboard/announcements/view-announcements',
    '/dashboard/profile',
  ],
  STUDENT: [
    '/dashboard/student',
    '/dashboard/events/check-in',
    '/dashboard/finance/statement-of-account',
    '/dashboard/finance/personal-receipts',
    '/dashboard/merchandise/order-merchandise',
    '/dashboard/merchandise/my-orders',
    '/dashboard/merchandise/claim-tokens',
    '/dashboard/elections/cast-vote',
    '/dashboard/elections/election-results',
    '/dashboard/announcements/view-announcements',
    '/dashboard/profile',
  ],
};

async function signIn(page, request, role) {
  const { schoolId, password } = ACCOUNTS[role];
  const login = await request.post(`${apiUrl}/login`, { data: { organization_id: 1, school_id: schoolId, password } });
  await expect(login, `login failed for ${role} (${schoolId})`).toBeOK();
  const payload = await login.json();
  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('selected_organization', JSON.stringify({ id: 1, name: 'HIUSA', acronym: 'HIUSA' }));
    // The elections hub shows a picker until an election is chosen; pre-select the
    // seeded one so the election sub-pages render their real content.
    window.sessionStorage.setItem('activeElectionId', '1');
  }, { token: payload.access_token, user: payload.user });
}

for (const role of Object.keys(ROUTES)) {
  test(`${role} can open every authorized page`, async ({ page, request }) => {
    // Each test walks every page for one role, so it needs far more than the
    // 30s default; without this the browser context closes mid-walk and the
    // remaining routes report spurious "browser has been closed" failures.
    test.setTimeout(300_000);
    await signIn(page, request, role);
    const failures = [];

    for (const path of ROUTES[role]) {
      try {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        // Shell mounted (a page crash with no error boundary blanks nav too).
        await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 12000 });
        const main = page.getByRole('main');
        await expect(main).toBeVisible({ timeout: 12000 });
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

    expect(failures, `Pages that did not render for ${role}:\n  ${failures.join('\n  ')}`).toEqual([]);
  });
}
