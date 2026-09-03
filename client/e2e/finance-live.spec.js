import { expect, test } from '@playwright/test';
import process from 'node:process';

const apiUrl = process.env.HIUSA_E2E_API_URL || 'http://127.0.0.1:8000/api';
const liveEnabled = process.env.HIUSA_LIVE_E2E === '1';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

async function signInAs(page, request, schoolId, password) {
  const login = await request.post(`${apiUrl}/login`, { data: { organization_id: 1, school_id: schoolId, password } });
  await expect(login).toBeOK();
  const payload = await login.json();
  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('selected_organization', JSON.stringify({ id: 1, name: 'HIUSA Student Body Organization', acronym: 'HIUSA' }));
  }, { token: payload.access_token, user: payload.user });
}

test('student can open the statement of account and cannot access admin audit logs', async ({ page, request }) => {
  await signInAs(page, request, 2100142, 'Demo@12345');
  await page.goto('/dashboard/finance/statement-of-account');
  await expect(page.getByRole('heading', { name: 'Statement of Account & Financial Clearance' })).toBeVisible();
  await page.goto('/dashboard/audit-logs');
  await expect(page).toHaveURL(/\/dashboard\/student$/);
});

test('admin can open the read-only audit log', async ({ page, request }) => {
  await signInAs(page, request, 990001, 'Admin@123456');
  await page.goto('/dashboard/audit-logs');
  await expect(page.getByRole('main').getByRole('heading', { name: 'General Audit Log' })).toBeVisible();
  await expect(page.getByText('Trace actors, records, academic context, approvals, payments, and before/after values across HIUSA.')).toBeVisible();
});
