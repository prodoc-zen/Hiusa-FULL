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
        ai_output: { id: 501, version: 1, decision_status: 'pending' },
        plan: 'Timeline:\n- Confirm schedule.\n\nResource Checklist:\n- Venue.\n\nLogistics Checklist:\n- Setup.\n\nPossible Delays or Conflicts:\n- Supplier delay.',
        workflow: {
          overview: 'Prepare and deliver Sports Fest safely.',
          preparation_phases: ['Confirm scope', 'Coordinate delivery'],
          timeline: ['Confirm schedule'],
          resources: ['Venue'],
          logistics: ['Setup'],
          risks: ['Supplier delay'],
          scheduling_conflicts: [],
          tasks: [
            { key: 'scope', title: 'Confirm event scope and vendor commitments', description: 'Confirm scope.', phase: 'pre_event', priority: 'high', deadline: '2026-09-01T08:00:00Z', depends_on_key: null, recommended_role: 'President', assigned_to: 900001, recommendation: { rankings: [{ officer_id: 900001, rank: 1, name: 'Marco Dela Cruz', position_title: 'President', final_score: 90 }] } },
            { key: 'timeline', title: 'Finalize event timeline and resources', description: 'Finalize timeline.', phase: 'pre_event', priority: 'medium', deadline: '2026-09-02T08:00:00Z', depends_on_key: 'scope', recommended_role: 'Secretary', assigned_to: 900003, recommendation: { rankings: [{ officer_id: 900003, rank: 1, name: 'Bianca Fernandez', position_title: 'Secretary', final_score: 88 }] } },
            { key: 'logistics', title: 'Complete logistics checklist', description: 'Complete setup.', phase: 'event_day', priority: 'high', deadline: '2026-09-03T08:00:00Z', depends_on_key: 'timeline', recommended_role: 'Business Manager', assigned_to: 900007, recommendation: { rankings: [{ officer_id: 900007, rank: 1, name: 'Grace Ibanez', position_title: 'Business Manager', final_score: 86 }] } },
            { key: 'risks', title: 'Review delays, conflicts, and contingencies', description: 'Review risks.', phase: 'post_event', priority: 'medium', deadline: '2026-09-04T08:00:00Z', depends_on_key: 'logistics', recommended_role: 'Auditor', assigned_to: 900005, recommendation: { rankings: [{ officer_id: 900005, rank: 1, name: 'Ellaine Morales', position_title: 'Auditor', final_score: 84 }] } },
          ],
        },
        tasks: [],
      }),
    });
  });
  await page.goto('/dashboard/events/event-planner');
  await expect(page.getByRole('heading', { name: 'Generate Event Plan' })).toBeVisible();
  await page.locator('select').first().selectOption({ label: 'Sports Fest 2024' });
  await page.getByPlaceholder('Timeline, resources, vendors, logistics, risks...').fill('Verify the complete planning workflow.');
  const generateWorkflow = page.getByRole('button', { name: 'Generate Workflow Draft' });
  await expect(generateWorkflow).toBeEnabled();
  await generateWorkflow.click();
  await expect(page.getByText('Generated workflow — review required', { exact: true })).toBeVisible();
  await expect(page.getByText('Preparation Phases', { exact: true })).toBeVisible();
  await expect(page.getByText('Timeline', { exact: true })).toBeVisible();
  await expect(page.getByText('Resources', { exact: true })).toBeVisible();
  await expect(page.getByText('Logistics Checklist', { exact: true })).toBeVisible();
  await expect(page.getByText('Risks / Conflicts', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm & Create Workflow' })).toBeVisible();
  expect(plannerRequest).toMatchObject({
    requirements: 'Verify the complete planning workflow.',
    create_workflow: true,
  });
  for (const [index, taskTitle] of [
    'Confirm event scope and vendor commitments',
    'Finalize event timeline and resources',
    'Complete logistics checklist',
    'Review delays, conflicts, and contingencies',
  ].entries()) {
    await expect(page.getByLabel(`Task ${index + 1} title`)).toHaveValue(taskTitle);
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
