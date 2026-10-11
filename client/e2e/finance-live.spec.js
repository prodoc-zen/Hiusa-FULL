import { expect, test } from '@playwright/test';
import { PSITS_ADVISER, STUDENT } from './support/accounts.js';
import { injectSession, liveEnabled, sessionFor } from './support/live.js';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

test('student can open the statement of account and cannot access admin audit logs', async ({ page }) => {
  await injectSession(page, await sessionFor(STUDENT));
  await page.goto('/dashboard/finance/statement-of-account');
  await expect(page.getByRole('heading', { name: 'Statement of Account & Financial Clearance' })).toBeVisible();
  await page.goto('/dashboard/audit-logs');
  await expect(page).toHaveURL(/\/dashboard\/student$/);
});

test('admin can open the read-only audit log', async ({ page }) => {
  await injectSession(page, await sessionFor(PSITS_ADVISER));
  await page.goto('/dashboard/audit-logs');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  await expect(page.getByText('Trace who changed a record, what changed, and when.')).toBeVisible();
  // Read only: the page offers search, filters and export, and nothing that edits or removes an entry.
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: /^(Edit|Delete|Remove)/ })).toHaveCount(0);
});
