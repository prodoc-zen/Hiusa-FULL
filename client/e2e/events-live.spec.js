import { expect, test } from '@playwright/test';
import process from 'node:process';

const apiUrl = process.env.HIUSA_E2E_API_URL || 'http://127.0.0.1:8000/api';
const liveEnabled = process.env.HIUSA_LIVE_E2E === '1';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

async function signInAs(page, request, schoolId, password) {
  const login = await request.post(`${apiUrl}/login`, {
    data: {
      organization_id: 1,
      school_id: schoolId,
      password,
    },
  });
  expect(login.ok()).toBeTruthy();

  const payload = await login.json();
  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('selected_organization', JSON.stringify({ id: 1, name: 'HIUSA Student Body Organization', acronym: 'HIUSA' }));
  }, { token: payload.access_token, user: payload.user });

  return payload.user;
}

test('admin can inspect event, planner, calendar, and attendance workflows', async ({ page, request }) => {
  await signInAs(page, request, 990001, 'Admin@123456');

  await page.goto('/dashboard/events/manage-events');
  await expect(page.getByRole('heading', { name: 'All Events' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'HIUSA General Assembly' }).first()).toBeVisible();

  await page.getByLabel('View HIUSA General Assembly').first().click();
  await expect(page.getByRole('heading', { name: 'HIUSA General Assembly' })).toBeVisible();
  await page.getByRole('button', { name: 'Close event details' }).click();

  await page.getByPlaceholder('Search events...').fill('Sports Fest');
  await expect(page.getByRole('cell', { name: 'Sports Fest 2024' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'HIUSA General Assembly' }).first()).toBeHidden();
  await page.getByPlaceholder('Search events...').fill('');

  await page.getByLabel('Edit Sports Fest 2024').first().click();
  await expect(page.getByText('Edit Event', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Vendor Deadlines')).toBeVisible();
  await expect(page.getByLabel('Logistics Checklist')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  let plannerRequest;
  await page.route('**/api/events/*/generate-plan', async (route) => {
    plannerRequest = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      status: 201,
      body: JSON.stringify({
        plan: 'Timeline:\n- Confirm schedule.\n\nResource Checklist:\n- Venue.\n\nLogistics Checklist:\n- Setup.\n\nPossible Delays or Conflicts:\n- Supplier delay.',
        tasks: [
          { id: 101, event_id: 3, title: 'Confirm event scope and vendor commitments', status: 'pending', deadline: '2026-09-01T08:00:00Z', event: { id: 3, title: 'Sports Fest 2024' } },
          { id: 102, event_id: 3, title: 'Finalize event timeline and resources', status: 'pending', deadline: '2026-09-02T08:00:00Z', event: { id: 3, title: 'Sports Fest 2024' } },
          { id: 103, event_id: 3, title: 'Complete logistics checklist', status: 'pending', deadline: '2026-09-03T08:00:00Z', event: { id: 3, title: 'Sports Fest 2024' } },
          { id: 104, event_id: 3, title: 'Review delays, conflicts, and contingencies', status: 'pending', deadline: '2026-09-04T08:00:00Z', event: { id: 3, title: 'Sports Fest 2024' } },
        ],
      }),
    });
  });
  await page.goto('/dashboard/events/event-planner');
  await expect(page.getByRole('heading', { name: 'Generate Event Plan' })).toBeVisible();
  await page.locator('select').first().selectOption({ label: 'Sports Fest 2024' });
  await page.getByPlaceholder('Timeline, resources, vendors, logistics, risks...').fill('Verify the complete planning workflow.');
  await expect(page.getByRole('button', { name: 'Generate' })).toBeEnabled();
  await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate' }).click();
  const renderedPlan = page.locator('pre');
  await expect(renderedPlan).toContainText('Timeline:');
  await expect(renderedPlan).toContainText('Resource Checklist:');
  await expect(renderedPlan).toContainText('Logistics Checklist:');
  await expect(renderedPlan).toContainText('Possible Delays or Conflicts:');
  expect(plannerRequest).toMatchObject({
    requirements: 'Verify the complete planning workflow.',
    create_workflow: true,
  });
  for (const taskTitle of [
    'Confirm event scope and vendor commitments',
    'Finalize event timeline and resources',
    'Complete logistics checklist',
    'Review delays, conflicts, and contingencies',
  ]) {
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
  }

  await page.goto('/dashboard/events/event-operations');
  await page.getByRole('button', { name: /Sports Fest 2024/ }).first().click();
  await expect(page.getByText('Biometric scanner integration')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scanner pending' })).toBeDisabled();
  await expect(page.getByText('Record Manual Attendance')).toBeVisible();
  await expect(page.getByLabel('Attendance status')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/events/activity-calendar');
  await expect(page.getByRole('heading', { name: 'All Events' })).toBeVisible();
  const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasPageOverflow).toBeFalsy();
});

test('student cannot open admin event management', async ({ page, request }) => {
  await signInAs(page, request, 2100142, 'Demo@12345');
  await page.goto('/dashboard/events/manage-events');
  await expect(page).toHaveURL(/\/dashboard\/student$/);
});
