import { test, expect } from '@playwright/test';
import { PSITS_ADMIN } from './support/accounts.js';
import { injectSession, sessionFor } from './support/live.js';

const structure = {
  department: 'College of Computer Studies',
  programs: [{ id: 1, name: 'BS Information Technology', sections: [{ id: 10, year_level: 1, name: '1 - Non Block' }, { id: 11, year_level: 1, name: '1-A' }, { id: 12, year_level: 1, name: '1-B' }, { id: 20, year_level: 2, name: '2 - Non Block' }, { id: 30, year_level: 3, name: '3 - Non Block' }, { id: 40, year_level: 4, name: '4 - Non Block' }] }],
};

test.beforeEach(async ({ page }) => {
  await injectSession(page, await sessionFor(PSITS_ADMIN));
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/academic-structure')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(structure) });
    if (url.includes('/sbo-positions')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { id: 1, role: 'ADMIN', title: 'President', is_active: true },
      { id: 2, role: 'SBO_OFFICER', title: 'Secretary', is_active: true },
    ]) });
    if (url.includes('/users')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
    return route.fallback();
  });
});

const jamie = { id: 20260001, school_id: 20260001, first_name: 'Jamie', last_name: 'Student', email: 'jamie@example.test', contact_number: '+63 912 345 6789', role: 'STUDENT', account_status: 'active', department: 'College of Computer Studies', program: '', major: '', year_level: '', section: '' };

async function openEditFor(page, user) {
  await page.route('**/api/users*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([user]) }));
  await page.route('**/api/finance/student-debts**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/dashboard/admin/users');
  const trigger = page.getByRole('button', { name: `Open actions for ${user.first_name} ${user.last_name}` });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await trigger.click();
  await page.getByRole('menuitem', { name: `Edit ${user.first_name} ${user.last_name}` }).click();
  return page.locator('#edit-user-form');
}

test('admin adds an existing student by name and never types a school ID or a password', async ({ page }) => {
  let invited = null;
  await page.route('**/api/account-profiles/organizations', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 2, name: 'PSITS-CCS' }] }) }));
  await page.route('**/api/people/search**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [
    { school_id: 20260001, name: 'Jamie Student', email: 'jamie@example.test', program: 'BSIT', role: 'STUDENT', organizations: [] },
  ] }) }));
  await page.route('**/api/account-profiles/invite', async (route) => {
    invited = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 5 } }) });
  });

  await page.goto('/dashboard/admin/users');
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New User' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add existing student' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an existing student' });
  await expect(dialog.getByText('Students without an account sign up themselves with their school ID.')).toBeVisible();
  await expect(dialog.getByLabel(/school id/i)).toHaveCount(0);
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Student' }).fill('jamie');
  await dialog.getByRole('option', { name: /Jamie Student/ }).click();
  await dialog.getByRole('button', { name: 'Add student' }).click();
  await expect.poll(() => invited).toMatchObject({ school_id: 20260001, organization_id: 2, role: 'STUDENT' });
});

test('editing a member offers controlled academic dropdowns', async ({ page }) => {
  const form = await openEditFor(page, jamie);
  const roleSelect = form.getByLabel('Role');
  // The position field only exists for roles that hold one.
  await expect(form.getByLabel('Organization Position')).toHaveCount(0);
  await roleSelect.selectOption('SBO_OFFICER');
  await expect(form.getByLabel('Organization Position')).toBeEnabled();
  await expect(form.getByLabel('Organization Position').locator('option')).toHaveText(['Choose a position', 'Secretary']);
  await roleSelect.selectOption('STUDENT');
  await expect(form.getByLabel('Organization Position')).toHaveCount(0);
  await expect(form.getByLabel('Year Level')).toBeDisabled();
  await form.getByLabel('Course or program').selectOption('BS Information Technology');
  await form.getByLabel('Year Level').selectOption('1st Year');
  await expect(form.getByLabel('Section')).toBeEnabled();
  await expect(form.getByLabel('Section').locator('option')).toHaveCount(4);
  await expect(form.getByLabel('Contact Number')).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  // The register filters by role and program; year level and section are chosen in the edit form.
  await expect(page.getByLabel('Filter by program')).toBeVisible();
});

test('section choices keep the letter case they are stored with', async ({ page }) => {
  const form = await openEditFor(page, jamie);
  await form.getByLabel('Course or program').selectOption('BS Information Technology');
  await form.getByLabel('Year Level').selectOption('1st Year');
  await expect(form.getByLabel('Section').locator('option')).toHaveText(['Choose a section', '1 - Non Block', '1-A', '1-B']);
});


test('programs and sections is available as an admin setup screen', async ({ page }) => {
  await page.goto('/dashboard/admin/programs-sections');
  await expect(page.getByRole('heading', { name: 'Programs and sections', level: 1 })).toBeVisible();
  await expect(page.getByText('College of Computer Studies').first()).toBeVisible();
  await expect(page.getByText('1 - Non Block, 1-A, 1-B')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'BS Information Technology', level: 3 })).toBeVisible();
  await expect(page.getByText('4 - Non Block')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit BS Information Technology' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete BS Information Technology' })).toBeVisible();
});

test('program names keep their upper-case abbreviation', async ({ page }) => {
  await page.goto('/dashboard/admin/programs-sections');
  await expect(page.getByRole('heading', { name: 'BS Information Technology', level: 3, exact: true })).toBeVisible();
});

test('user register stays compact and keeps private contact details in View', async ({ page }) => {
  const user = { id: 20260001, school_id: 20260001, first_name: 'Jamie', last_name: 'Student', email: 'jamie@example.test', contact_number: '+63 912 345 6789', role: 'STUDENT', account_status: 'active', department: 'College of Computer Studies', program: 'BS Information Technology', major: 'Web Development', year_level: '1st Year', section: '1 - Non Block' };
  await page.route('**/api/users*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([user]) }));
  await page.route('**/api/finance/student-debts**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto('/dashboard/admin/users');
  await expect(page.getByRole('columnheader', { name: 'Email' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'SBO Position' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Program', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: /1st Year · 1 - Non Block/ })).toBeVisible();
  await expect(page.getByText('jamie@example.test')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Open actions for Jamie Student' });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await trigger.click();
  await page.getByRole('menuitem', { name: 'View Jamie Student' }).click();
  await expect(page.getByText('jamie@example.test')).toBeVisible();
  await expect(page.getByText('+63 912 345 6789')).toBeVisible();
});
