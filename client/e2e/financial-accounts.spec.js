import { test, expect } from '@playwright/test';

const account = {
  student: { school_id: 20260001, name: 'Alex Rivera', email: 'alex@example.test', department: 'Computing', program: 'BSIT', year_level: '3rd Year', section: 'A', account_status: 'active' },
  invoice_debt: 750,
  reserved_order_debt: 250,
  total_debt: 1000,
  clearance_status: 'pending_clearance',
  unpaid_invoice_count: 1,
  pending_order_count: 1,
  pending_payment_count: 0,
  overdue_invoice_count: 1,
  invoices: [{ id: 1, reference: 'INV-TEST', description: 'Organization fee', amount_paid: 0, remaining_balance: 750, due_date: '2026-01-01', status: 'unpaid' }],
  reserved_orders: [{ id: 4, total_price: 250, payment_proof_url: null, merchandise: { name: 'HIUSA Shirt' } }],
};

test('admin can review paginated student financial accounts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Admin', last_name: 'User', email: 'admin@example.test' }));
  });
  await page.route('**/api/notifications**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ notifications: [], unread_count: 0 }) }));
  await page.route('**/api/student-debts**', async (route) => {
    const url = new URL(route.request().url());
    const currentPage = Number(url.searchParams.get('page') || 1);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [account], current_page: currentPage, per_page: 10, total: 17, last_page: 2, summary: { total_students: 17, students_owing: 5, students_cleared: 12, students_overdue: 1, total_outstanding: 1000 }, filter_options: { departments: ['Computing'], programs: ['BSIT'], year_levels: ['3rd Year'] } }) });
  });

  await page.goto('/dashboard/finance/student-accounts');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Student Financial Accounts' })).toBeVisible();
  await expect(page.getByText('Alex Rivera').first()).toBeVisible();
  await expect(page.getByText('₱1,000.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'View account' }).first().click();
  await expect(page.getByRole('heading', { name: 'Student Financial Account', exact: true })).toBeVisible();
  await expect(page.getByText('INV-TEST · Organization fee')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Next page of student accounts' }).click();
  await expect(page.getByRole('button', { name: 'Page 2 of student accounts' })).toHaveAttribute('aria-current', 'page');
});
