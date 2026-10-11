import { expect, test } from '@playwright/test';
import { PSITS_ADMIN } from './support/accounts.js';
import { injectSession, liveEnabled, sessionFor } from './support/live.js';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

// The old Create Task page and Task Board merged: Create Task is the board's "New task" view
// (task-board?new=1) and the old path redirects there (docs/UX_FLOW.md section 3.3).
function isoDate(daysAhead) {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  return date.toISOString().slice(0, 10);
}

test('New task opens in place on the Task board and the old Create Task path lands there', async ({ page }) => {
  test.setTimeout(90_000);
  await injectSession(page, await sessionFor(PSITS_ADMIN));
  const title = `E2E orientation kit ${Date.now()}`;

  await page.goto('/dashboard/tasks/create-task');
  await expect(page).toHaveURL(/\/dashboard\/tasks\/task-board\?new=1$/);
  await expect(page.getByRole('heading', { name: 'New task', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toHaveCount(0);
  await expect(page.getByText('Best-fit recommendation')).toBeVisible();

  await page.getByLabel('Task Title *').fill(title);
  await page.getByLabel('Deadline *').fill(isoDate(30));
  await page.getByRole('button', { name: 'Review officer recommendation' }).click();
  await page.getByText('Admin chooses the final assignee.').locator('xpath=following-sibling::button[1]').click();
  await page.getByRole('button', { name: 'Create Task', exact: true }).click();
  await expect(page.getByText(/was created and assigned to/)).toBeVisible();

  await page.getByRole('button', { name: 'Back to tasks' }).click();
  await expect(page).toHaveURL(/\/dashboard\/tasks\/task-board$/);
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task details' })).toHaveCount(0);
  // The app title-cases task names, so match the text without regard to case.
  await expect(page.getByText(new RegExp(title, 'i')).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page).toHaveURL(/\/dashboard\/tasks\/task-board\?new=1$/);
  await expect(page.getByRole('heading', { name: 'Task details' })).toBeVisible();
});

test('the best-fit officer is labelled Recommended in the review list', async ({ page }) => {
  await injectSession(page, await sessionFor(PSITS_ADMIN));
  await page.goto('/dashboard/tasks/task-board?new=1');
  await page.getByLabel('Task Title *').fill(`E2E recommendation label ${Date.now()}`);
  await page.getByRole('button', { name: 'Review officer recommendation' }).click();
  await expect(page.getByRole('button', { name: /Recommended/ })).toHaveCount(1);
});

test('Task progress is the board\'s Progress view and the old path lands there', async ({ page }) => {
  await injectSession(page, await sessionFor(PSITS_ADMIN));
  await page.goto('/dashboard/tasks/task-progress');
  await expect(page).toHaveURL(/\/dashboard\/tasks\/task-board\?view=progress$/);
  await expect(page.getByRole('heading', { name: 'Task progress', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Officer Workload' })).toBeVisible();
});
