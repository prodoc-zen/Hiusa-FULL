import { test, expect } from '@playwright/test';

const buyer = { school_id: 21000001, first_name: 'Juan', last_name: 'Dela Cruz', email: 'juan@example.test', department: 'College of Computer Studies', program: 'BS Information Technology', major: 'Web Development', year_level: '4th Year', section: '4-A', role: 'STUDENT', position_title: null, account_status: 'active' };
const order = { id: 7, student_id: buyer.school_id, student: buyer, merchandise: { id: 3, name: 'HIUSA Shirt', category: 'Apparel', price: '500.00' }, quantity: 1, total_price: '500.00', payment_method: 'gcash', payment_reference: '1234567890123', status: 'paid', officer_review_status: 'approved', admin_review_status: 'approved', processor: { first_name: 'SBO', last_name: 'Officer' }, approver: { first_name: 'Admin', last_name: 'Reviewer' }, claim_verifier: null, transaction: { receipt_reference: 'MERCH-ORD-7', receipt_number: 4, transaction_date: '2026-08-30T09:00:00Z' }, created_at: '2026-08-29T09:00:00Z', claimed_at: null };

test('merchandise management exposes dependent filters, KPIs, detailed columns, and drill-downs', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ school_id: 1, role: 'ADMIN', first_name: 'Admin', last_name: 'User' }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/orders/analytics/users')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ ...buyer, orders: [order] }], total: 1 }) });
    if (url.includes('/orders')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [order], current_page: 1, last_page: 1, total: 1, per_page: 20, summary: { total_users: 45, purchased_users: 37, not_purchased_users: 8, purchase_rate: 82.22, total_orders: 39, paid_orders: 34, pending_orders: 5, claimed_orders: 29, unclaimed_orders: 5, total_quantity: 39, total_collected: 17000, outstanding_balance: 2500, breakdown: [{ id: 3, name: 'HIUSA Shirt', quantity: 39, orders_count: 39, collected: 17000 }] }, filter_options: { departments: ['College of Computer Studies'], programs: [{ id: 1, name: 'BS Information Technology', sections: [{ id: 1, year_level: 4, name: '4-A' }] }], majors: ['Web Development'], roles: ['STUDENT', 'SBO_OFFICER'], positions: ['President'], merchandise: [{ id: 3, name: 'HIUSA Shirt' }], statuses: ['pending', 'paid', 'claimed', 'cancelled'], payment_statuses: ['pending', 'paid'], payment_methods: ['cash', 'gcash'] } }) });
    if (url.includes('/merchandise')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 3, name: 'HIUSA Shirt', price: 500, stock_quantity: 10, is_active: true }]) });
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });

  await page.goto('/dashboard/merchandise/manage-orders');
  await expect(page.getByRole('heading', { name: 'Merchandise Order Intelligence' })).toBeVisible();
  await expect(page.getByText('37', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByLabel('Program or course').selectOption('BS Information Technology');
  await page.getByLabel('Year level').selectOption('4th Year');
  await expect(page.getByLabel('Section')).toBeEnabled();
  await expect(page.getByLabel('Section').locator('option')).toHaveText(['All sections', '4-A']);
  await expect(page.getByRole('columnheader', { name: 'Academic Profile' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Review Trail' })).toBeVisible();
  await page.getByRole('button', { name: /Purchased/ }).click();
  await expect(page.getByRole('heading', { name: 'Purchased' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MERCH-ORD-7', exact: true })).toBeVisible();
});
