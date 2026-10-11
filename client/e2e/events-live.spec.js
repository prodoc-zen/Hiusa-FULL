import { expect, test } from '@playwright/test';
import { PSITS_ADVISER, STUDENT } from './support/accounts.js';
import { injectSession, liveEnabled, openRowMenu, sessionFor } from './support/live.js';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

async function signInAs(page, account) {
  await injectSession(page, await sessionFor(account));
}

test('admin can inspect event, planner, calendar, and attendance workflows', async ({ page }) => {
  await signInAs(page, PSITS_ADVISER);

  await page.goto('/dashboard/events/manage-events');
  await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
  await expect(page.getByRole('cell', { name: /HIUSA General Assembly/ }).first()).toBeVisible();

  const assemblyRow = page.getByRole('row').filter({ hasText: 'HIUSA General Assembly' });
  await openRowMenu(page, assemblyRow);
  await page.getByRole('menuitem', { name: 'View event' }).click();
  await expect(page.getByRole('dialog', { name: 'Event details' }).getByRole('heading', { name: 'HIUSA General Assembly' })).toBeVisible();
  await page.getByRole('button', { name: 'Close event details' }).click();

  await page.getByPlaceholder('Search events').fill('Sports Fest');
  await expect(page.getByRole('cell', { name: /Sports Fest 2024/ }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /HIUSA General Assembly/ }).first()).toBeHidden();

  await openRowMenu(page, page.getByRole('row').filter({ hasText: 'Sports Fest 2024' }));
  await page.getByRole('menuitem', { name: 'Edit event' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit event' }).getByRole('heading', { name: 'Edit event' })).toBeVisible();
  await expect(page.getByLabel('Vendor Deadlines')).toBeVisible();
  await expect(page.getByLabel('Logistics Checklist')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByPlaceholder('Search events').fill('');
  await expect(page.getByRole('cell', { name: /HIUSA General Assembly/ }).first()).toBeVisible();

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
  await expect(page.getByRole('heading', { name: 'Planning', level: 1 })).toBeVisible();
  await page.getByLabel('Event', { exact: true }).selectOption({ label: 'Sports Fest 2024' });
  await page.getByLabel('Optional planning context').fill('Verify the complete planning workflow.');
  const createToDoList = page.getByRole('button', { name: 'Draft Editable To-do List' });
  await expect(createToDoList).toBeEnabled();
  await createToDoList.click();
  await expect(page.getByText(/\d+ suggested to-do items/)).toBeVisible();
  await expect(page.getByText('Plan outline', { exact: true })).toBeVisible();
  await expect(page.getByText('Key dates', { exact: true })).toBeVisible();
  await expect(page.getByText('What is needed', { exact: true })).toBeVisible();
  await expect(page.getByText('Setup and coordination', { exact: true })).toBeVisible();
  await expect(page.getByText('Possible problems', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and Assign Tasks' })).toBeVisible();
  expect(plannerRequest).toEqual({
    requirements: 'Verify the complete planning workflow.',
  });
  for (const [index, taskTitle] of [
    'Confirm event scope and vendor commitments',
    'Finalize event timeline and resources',
    'Complete logistics checklist',
    'Review delays, conflicts, and contingencies',
  ].entries()) {
    await expect(page.getByLabel(`Task ${index + 1} title`)).toHaveValue(taskTitle);
  }

  // The old event-operations page is now the Check-in step of Events and tasks.
  await page.goto('/dashboard/events/event-operations');
  await expect(page).toHaveURL(/\/dashboard\/events\/check-in$/);
  await expect(page.getByRole('heading', { name: 'Check-in', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Open attendance for Sports Fest 2024' }).click();
  await expect(page.getByText('Fingerprint check-in / checkout')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan Fingerprint' })).toBeDisabled();
  await expect(page.getByText('Manual check-in', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Attendance status')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/events/activity-calendar');
  await expect(page).toHaveURL(/\/dashboard\/events\/manage-events\?view=calendar$/);
  await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
  const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasPageOverflow).toBeFalsy();
});

test('student cannot open admin event management', async ({ page }) => {
  await signInAs(page, STUDENT);
  await page.goto('/dashboard/events/manage-events');
  await expect(page).toHaveURL(/\/dashboard\/student$/);
});
