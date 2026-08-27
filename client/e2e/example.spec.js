import { test, expect } from '@playwright/test';

test('selects an organization and continues to login', async ({ page }) => {
  await page.route('**/api/organizations', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          name: 'HIUSA Student Body Organization',
          acronym: 'HIUSA',
          college: 'Sample College',
        },
      ]),
    });
  });

  await page.goto('/select-organization');
  await expect(page.getByRole('heading', { name: 'Find your organization' })).toBeVisible();
  await page.getByRole('button', { name: 'HIUSA' }).click();
  await page.getByRole('button', { name: 'Continue to login' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
});
