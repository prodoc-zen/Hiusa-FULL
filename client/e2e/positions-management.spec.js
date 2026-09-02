import { expect, test } from '@playwright/test';

test('admin manages role-aware positions with ten rows per page', async ({ page }) => {
  const positions = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    organization_id: 1,
    role: index < 6 ? 'ADMIN' : 'SBO_OFFICER',
    title: index === 0 ? 'President' : `Position ${index + 1}`,
    description: 'Organization responsibility',
    is_active: true,
  }));

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ role: 'ADMIN', first_name: 'Admin', last_name: 'User' }),
    );
  });
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
  await expect(page.getByRole('heading', { name: 'Manage Positions', level: 2 })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Next page of positions' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Add Position' }).click();
  await page.getByLabel('Assignable account role').selectOption('ADMIN');
  await page.getByLabel('Position title').fill('Executive Secretary');
  await page.getByRole('button', { name: 'Save Position' }).click();
  await expect(page.getByText('Position created successfully.')).toBeVisible();

  await page.getByLabel('Filter positions by account role').selectOption('ADMIN');
  await page.getByRole('button', { name: 'Edit President' }).click();
  await page.getByLabel('Position title').fill('Organization President');
  await page.getByRole('button', { name: 'Save Position' }).click();
  await expect(page.getByText('Position updated successfully.')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Organization President' }).click();
  await page.getByRole('button', { name: 'Delete Position', exact: true }).click();
  await expect(page.getByText('Organization President was deleted.')).toBeVisible();
});
