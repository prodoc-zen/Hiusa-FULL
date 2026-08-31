import { test, expect } from '@playwright/test';

const structure = {
  department: 'College of Computer Studies',
  programs: [{ id: 1, name: 'BS Information Technology', sections: [{ id: 10, year_level: 1, name: '1 - Non Block' }, { id: 11, year_level: 1, name: '1-A' }, { id: 12, year_level: 1, name: '1-B' }, { id: 20, year_level: 2, name: '2 - Non Block' }, { id: 30, year_level: 3, name: '3 - Non Block' }, { id: 40, year_level: 4, name: '4 - Non Block' }] }],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ school_id: 1, role: 'ADMIN', first_name: 'Admin', last_name: 'User' }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/academic-structure')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(structure) });
    if (url.includes('/sbo-positions')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (url.includes('/users')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
  });
});

test('admin user management offers controlled academic dropdowns', async ({ page }) => {
  await page.goto('/dashboard/admin/users');
  await page.getByRole('button', { name: 'New User' }).click();
  await expect(page.getByRole('textbox', { name: 'Department', exact: true })).toHaveValue('College of Computer Studies');
  const form = page.locator('#create-user-form');
  await form.getByLabel('Course / Program').selectOption('BS Information Technology');
  await form.getByLabel('Year Level').selectOption('1st Year');
  await expect(form.getByLabel('Section')).toBeEnabled();
  await expect(form.getByLabel('Section').locator('option')).toHaveText(['Choose a section', '1 - Non Block', '1-A', '1-B']);
  await expect(form.getByLabel('Contact Number')).toBeVisible();
  await expect(page.getByLabel('Filter by program')).toBeVisible();
  await expect(page.getByLabel('Filter by year level')).toBeVisible();
  await expect(page.getByLabel('Filter by section')).toBeVisible();
});

test('programs and sections is available as an admin setup screen', async ({ page }) => {
  await page.goto('/dashboard/admin/programs-sections');
  await expect(page.getByRole('heading', { name: 'Programs & Sections', level: 2 })).toBeVisible();
  await expect(page.getByText('College of Computer Studies')).toBeVisible();
  await expect(page.getByLabel('1st Year sections')).toHaveValue('0');
  await expect(page.getByText('BS Information Technology')).toBeVisible();
  await expect(page.getByText('4 - Non Block')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit BS Information Technology' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete BS Information Technology' })).toBeVisible();
});

test('user register stays compact and keeps private contact details in View', async ({ page }) => {
  const user = { id: 20260001, school_id: 20260001, first_name: 'Jamie', last_name: 'Student', email: 'jamie@example.test', contact_number: '+63 912 345 6789', role: 'STUDENT', account_status: 'active', department: 'College of Computer Studies', program: 'BS Information Technology', major: 'Web Development', year_level: '1st Year', section: '1 - Non Block' };
  await page.route('**/api/users*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([user]) }));
  await page.route('**/api/finance/student-debts**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto('/dashboard/admin/users');
  await expect(page.getByRole('columnheader', { name: 'Email' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'SBO Position' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Program / Major' })).toBeVisible();
  await expect(page.getByText('1 - Non Block')).toBeVisible();
  await expect(page.getByText('jamie@example.test')).toHaveCount(0);
  await page.getByRole('button', { name: 'View Jamie Student' }).click();
  await expect(page.getByText('jamie@example.test')).toBeVisible();
  await expect(page.getByText('+63 912 345 6789')).toBeVisible();
});
