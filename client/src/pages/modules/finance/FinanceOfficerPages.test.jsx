import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialCollectionsPage from './FinancialCollectionsPage';
import StudentFinancialAccountsPage from './StudentFinancialAccountsPage';

const mocks = vi.hoisted(() => ({
  getFinancialDashboard: vi.fn(), getCollections: vi.fn(), createCollection: vi.fn(), verifyCollection: vi.fn(), recordRemittance: vi.fn(),
  getCashAdvances: vi.fn(), createCashAdvance: vi.fn(), approveCashAdvance: vi.fn(), releaseCashAdvance: vi.fn(), repayCashAdvance: vi.fn(),
  getStudentDebts: vi.fn(), createInvoice: vi.fn(), recordInvoicePayment: vi.fn(), updateInvoiceStatus: vi.fn(),
}));
vi.mock('../../../services/financeService', () => mocks);
vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));

const TREASURER = { role: 'SBO_OFFICER', can_handle_finance: true, school_id: 10 };
const ADMIN = { role: 'ADMIN', school_id: 10 };

describe('Collections and advances for an officer whose position handles finance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFinancialDashboard.mockResolvedValue({ data: { available_funds: 850, total_collections: 1000, total_remitted: 200, unremitted_collections: 800, admin_count: 1 } });
    mocks.getCollections.mockResolvedValue({ data: [
      { id: 1, source: 'Event fee', reference: 'COL-1', status: 'pending', amount_collected: 100, collected_by: 11, unremitted_balance: 100, total_remitted: 0 },
      { id: 2, source: 'Membership', reference: 'COL-2', status: 'verified', amount_collected: 1000, collected_by: 11, unremitted_balance: 800, total_remitted: 200 },
    ] });
    mocks.getCashAdvances.mockResolvedValue({ data: [{ id: 4, reference: 'CA-4', purpose: 'Booth supplies', status: 'pending', amount: 500, amount_repaid: 0, remaining_balance: 500, borrower_id: 99, created_at: '2026-08-01T00:00:00Z' }] });
  });

  const renderPage = (user) => {
    localStorage.setItem('user', JSON.stringify(user));
    return render(<MemoryRouter><FinancialCollectionsPage /></MemoryRouter>);
  };

  it('records collections and remittances', async () => {
    renderPage(TREASURER);
    expect((await screen.findAllByText('Membership')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Record collection' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remit' }).length).toBeGreaterThan(0);
  });

  it('leaves verification to the Admin', async () => {
    renderPage(TREASURER);
    await screen.findAllByText('Membership');
    screen.getAllByRole('button', { name: 'Verify' }).forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByText(/An Admin verifies collections before/)).toBeInTheDocument();
  });

  it('does not tell an officer they are the only admin', async () => {
    renderPage(TREASURER);
    await screen.findAllByText('Membership');
    expect(screen.queryByText(/You are the only admin/)).not.toBeInTheDocument();
  });

  it('shows cash advances switched off: no asking for, approving or releasing any', async () => {
    renderPage(TREASURER);
    expect((await screen.findAllByText('Booth supplies')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Request cash advance' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Actions for Booth supplies/ }));
    expect(await screen.findByRole('menuitem', { name: 'Approve' })).toBeDisabled();
  });

  it('still lets an Admin verify and request an advance', async () => {
    renderPage(ADMIN);
    expect((await screen.findAllByRole('button', { name: 'Verify' }))[0]).toBeEnabled();
    expect(await screen.findByRole('button', { name: 'Request cash advance' })).toBeEnabled();
  });
});

describe('Student accounts for an officer whose position handles finance', () => {
  const invoice = { id: 7, reference: 'INV-ABC123', description: 'Organization fee', amount_due: '300.00', amount_paid: 0, remaining_balance: 300, due_date: null, status: 'unpaid', order_id: null };
  const account = {
    student: { school_id: 2026001, name: 'Ana Reyes', email: 'ana@example.test', department: 'Computing', program: 'BSIT', year_level: '3rd Year', section: 'A' },
    invoice_debt: 300, reserved_order_debt: 0, total_debt: 300, unpaid_invoice_count: 1, pending_order_count: 0, overdue_invoice_count: 0, pending_payment_count: 0,
    invoices: [invoice], reserved_orders: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStudentDebts.mockImplementation((params) => Promise.resolve(params?.student_id
      ? { data: [account] }
      : { data: { data: [account], summary: { total_outstanding: 300, students_owing: 1, students_cleared: 0, students_overdue: 0, total_students: 1 }, filter_options: { departments: [], programs: [], year_levels: [] }, total: 1, per_page: 10, current_page: 1 } }));
  });

  async function openAccount(user) {
    localStorage.setItem('user', JSON.stringify(user));
    render(<MemoryRouter><StudentFinancialAccountsPage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'View account' }))[0]);
    return screen.findByRole('dialog', { name: 'Student financial account' });
  }

  it('charges and records payments but has cancel or waive switched off', async () => {
    const dialog = await openAccount(TREASURER);
    expect(within(dialog).getAllByRole('button', { name: 'Record payment' }).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Cancel or waive invoice INV-ABC123' })).toBeDisabled();
  });

  it('lets an Admin cancel or waive an invoice', async () => {
    const dialog = await openAccount(ADMIN);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel or waive invoice INV-ABC123' })).toBeEnabled());
  });
});
