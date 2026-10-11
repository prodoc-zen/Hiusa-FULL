import { expect, test } from '@playwright/test';
import { PSITS_ADMIN } from './support/accounts.js';
import { injectSession, openRowMenu, sessionFor } from './support/live.js';

test('admin manages role-aware positions with ten rows per page', async ({ page }) => {
  const positions = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    organization_id: 1,
    role: index < 6 ? 'ADMIN' : 'SBO_OFFICER',
    title: index === 0 ? 'President' : `Position ${index + 1}`,
    description: 'Organization responsibility',
    is_active: true,
  }));

  // A real Admin session (the app checks the token with the API); only the positions list is answered
  // from the fixture so the paging and the forms have known data.
  await injectSession(page, await sessionFor(PSITS_ADMIN));
  await page.route('**/api/notifications**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ notifications: [], unread_count: 0 }),
    }),
  );
  await page.route('**/api/sbo-positions**', async (route) => {
    const request = route.request();
    const method = request.method();
    const id = Number(new URL(request.url()).pathname.split('/').pop());

    if (method === 'POST') {
      const created = { id: 99, organization_id: 1, ...request.postDataJSON() };
      positions.push(created);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
    }
    if (method === 'PUT') {
      const index = positions.findIndex((position) => position.id === id);
      positions[index] = { ...positions[index], ...request.postDataJSON() };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(positions[index]) });
    }
    if (method === 'DELETE') {
      positions.splice(positions.findIndex((position) => position.id === id), 1);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Position deleted successfully.' }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(positions) });
  });

  await page.goto('/dashboard/admin/positions');
  await expect(page.getByRole('heading', { name: 'Officer positions', level: 1 })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Next page of positions' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Add Position' }).click();
  await page.getByLabel('Assignable account role').selectOption('ADMIN');
  // Admin titles come from a list; anything else is typed under "Other position...".
  await page.getByLabel('Position title').selectOption('__other__');
  await page.getByLabel('Other position title').fill('Executive Secretary');
  await page.getByRole('button', { name: 'Save Position' }).click();
  await expect(page.getByText('Position created successfully.')).toBeVisible();

  await page.getByLabel('Filter positions by account role').selectOption('ADMIN');
  await openRowMenu(page, page.getByRole('row').filter({ hasText: 'President' }));
  await page.getByRole('menuitem', { name: 'Edit position' }).click();
  await page.getByLabel('Position title').selectOption('__other__');
  await page.getByLabel('Other position title').fill('Organization President');
  await page.getByRole('button', { name: 'Save Position' }).click();
  await expect(page.getByText('Position updated successfully.')).toBeVisible();

  await openRowMenu(page, page.getByRole('row').filter({ hasText: 'Organization President' }));
  await page.getByRole('menuitem', { name: 'Delete position' }).click();
  await page.getByLabel(/^Type Organization President to confirm/).fill('Organization President');
  await page.getByRole('button', { name: 'Delete Position', exact: true }).click();
  await expect(page.getByText('Organization President was deleted.')).toBeVisible();
});
