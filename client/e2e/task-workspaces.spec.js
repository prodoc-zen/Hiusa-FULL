import { test, expect } from '@playwright/test';

const officer = { id: 22000001, school_id: 22000001, first_name: 'Alex', last_name: 'Officer', role: 'SBO_OFFICER', position_title: 'Secretary', account_status: 'active' };
const task = { id: 14, title: 'Prepare orientation materials', description: 'Complete the registration kit.', assigned_to: officer.school_id, assignee: officer, event_id: 3, event: { id: 3, title: 'Student Orientation' }, deadline: '2026-09-30', status: 'pending', progress_percent: 0, task_type: 'regular', created_at: '2026-08-31T08:00:00Z' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ school_id: 1, role: 'ADMIN', first_name: 'Admin', last_name: 'User' }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/tasks')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().method() === 'POST' ? task : [task]) });
    }
    if (url.includes('/users')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([officer]) });
    if (url.includes('/events')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 3, title: 'Student Orientation' }]) });
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
});

test('Create Task is a dedicated creation workspace, separate from Task Board', async ({ page }) => {
  await page.goto('/dashboard/tasks/create-task');
  await expect(page.getByRole('heading', { name: 'Create a New Task' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toHaveCount(0);
  await expect(page.getByText('Best-fit recommendation')).toBeVisible();
  await page.getByLabel('Task Title *').fill('Prepare orientation materials');
  await page.getByLabel('Deadline *').fill('2026-09-30');
  await page.getByRole('button', { name: 'Create Task', exact: true }).click();
  await expect(page.getByText(/was created and assigned to Alex Officer/)).toBeVisible();

  await page.goto('/dashboard/tasks/task-board');
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a New Task' })).toHaveCount(0);
  await expect(page.getByText('Prepare orientation materials')).toBeVisible();
});
