import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentFinancialAccountsPage from './StudentFinancialAccountsPage';

const mocks = vi.hoisted(() => ({
  getStudentDebts: vi.fn(), createInvoice: vi.fn(), recordInvoicePayment: vi.fn(), updateInvoiceStatus: vi.fn(),
}));
vi.mock('../../../services/financeService', () => mocks);
const people = vi.hoisted(() => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/peopleService', () => people);

const invoice = (overrides) => ({
  id: 7, reference: 'INV-ABC123', description: 'Organization fee', amount_due: '300.00', amount_paid: 0, remaining_balance: 300,
  due_date: null, status: 'unpaid', order_id: null, ...overrides,
});

const accountWith = (invoices) => ({
  student: { school_id: 2026001, name: 'Ana Reyes', email: 'ana@example.test', department: 'Computing', program: 'BSIT', year_level: '3rd Year', section: 'A' },
  invoice_debt: invoices.reduce((sum, item) => sum + item.remaining_balance, 0),
  reserved_order_debt: 0,
  total_debt: invoices.reduce((sum, item) => sum + item.remaining_balance, 0),
  unpaid_invoice_count: invoices.length, pending_order_count: 0, overdue_invoice_count: 0, pending_payment_count: 0,
  invoices, reserved_orders: [],
});

describe('StudentFinancialAccountsPage invoice cancellation', () => {
  let account;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    account = accountWith([invoice(), invoice({ id: 8, reference: 'INV-PARTIAL', amount_paid: 100, remaining_balance: 200, status: 'partially_paid' })]);
    mocks.getStudentDebts.mockImplementation((params) => Promise.resolve(params?.student_id
      ? { data: [account] }
      : { data: { data: [account], summary: { total_outstanding: account.total_debt, students_owing: 1, students_cleared: 0, students_overdue: 0, total_students: 1 }, filter_options: { departments: [], programs: [], year_levels: [] }, total: 1, per_page: 10, current_page: 1 } }));
  });

  async function openAccount() {
    render(<StudentFinancialAccountsPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'View account' }))[0]);

    return screen.findByRole('dialog', { name: 'Student financial account' });
  }

  // The shared overlays give every dialog the same title id, so a dialog opened over another is found by position, not by name.
  async function openCloseDialog(accountDialog) {
    fireEvent.click(within(accountDialog).getByRole('button', { name: 'Cancel or waive invoice INV-ABC123' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    const form = screen.getAllByRole('dialog')[1];
    expect(within(form).getByRole('heading', { name: 'Cancel or waive invoice' })).toBeInTheDocument();

    return form;
  }

  it('offers cancel or waive only on an invoice with no approved payment', async () => {
    const dialog = await openAccount();

    expect(within(dialog).getByRole('button', { name: 'Cancel or waive invoice INV-ABC123' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel or waive invoice INV-PARTIAL' })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Record payment' })).toHaveLength(2);
  });

  it('cancels the invoice with a reason, then reloads the account without it', async () => {
    mocks.updateInvoiceStatus.mockImplementation(async () => {
      account = accountWith([invoice({ id: 8, reference: 'INV-PARTIAL', amount_paid: 100, remaining_balance: 200, status: 'partially_paid' })]);

      return { data: { id: 7, status: 'cancelled' } };
    });
    const dialog = await openAccount();
    const form = await openCloseDialog(dialog);

    expect(within(form).getByRole('button', { name: 'Cancel invoice' })).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Charged to the wrong student.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel invoice' }));

    await waitFor(() => expect(mocks.updateInvoiceStatus).toHaveBeenCalledWith(7, { status: 'cancelled', reason: 'Charged to the wrong student.' }));
    expect(await screen.findByText('Invoice cancelled and removed from the balance.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getStudentDebts).toHaveBeenCalledWith({ student_id: 2026001 }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel or waive invoice INV-ABC123' })).not.toBeInTheDocument());
  });

  it('waives the balance when the waive action is chosen', async () => {
    mocks.updateInvoiceStatus.mockResolvedValue({ data: { id: 7, status: 'waived' } });
    const dialog = await openAccount();
    const form = await openCloseDialog(dialog);

    fireEvent.change(within(form).getByLabelText('Action'), { target: { value: 'waived' } });
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Scholar excused from the fee.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Waive balance' }));

    await waitFor(() => expect(mocks.updateInvoiceStatus).toHaveBeenCalledWith(7, { status: 'waived', reason: 'Scholar excused from the fee.' }));
    expect(await screen.findByText('Invoice waived and removed from the balance.')).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the refusal when the server rejects the change', async () => {
    mocks.updateInvoiceStatus.mockRejectedValue({ response: { status: 409, data: { message: 'Payments were already approved on this invoice, so it can no longer be cancelled or waived.' } } });
    const dialog = await openAccount();
    const form = await openCloseDialog(dialog);

    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Issued in error.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel invoice' }));

    expect(await within(form).findByText('Payments were already approved on this invoice, so it can no longer be cancelled or waived.')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(within(form).getByRole('button', { name: 'Cancel invoice' })).toBeEnabled();
    expect(mocks.getStudentDebts).not.toHaveBeenCalledWith({ student_id: 2026001 });
  });

  it('warns that removing a charge billing an order returns the order to pending merchandise', async () => {
    account = accountWith([invoice({ order_id: 12 })]);
    const dialog = await openAccount();
    const form = await openCloseDialog(dialog);

    expect(within(form).getByText(/This charge bills merchandise order ORD-12/)).toBeInTheDocument();
  });

  it('sends nothing when the dialog is dismissed', async () => {
    const dialog = await openAccount();
    const form = await openCloseDialog(dialog);

    fireEvent.click(within(form).getByRole('button', { name: 'Keep invoice' }));

    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(mocks.updateInvoiceStatus).not.toHaveBeenCalled();
  });
});

describe('StudentFinancialAccountsPage header and empty states', () => {
  const emptyPayload = { data: { data: [], summary: {}, filter_options: { departments: [], programs: [], year_levels: [] }, total: 0, per_page: 10, current_page: 1 } };
  const renderPage = () => render(<MemoryRouter initialEntries={['/dashboard/finance/student-accounts']}><StudentFinancialAccountsPage /></MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getStudentDebts.mockResolvedValue(emptyPayload);
  });

  it('uses the shared header: one h1 from the menu label, no lead line and one primary action', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Student accounts' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/Review charges, payments, and student clearance/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add student charge' })).toHaveLength(1);
  });

  it('adds a charge to a student found by name, without typing a school ID', async () => {
    people.searchPeople.mockResolvedValue([{ school_id: 2026001, name: 'Ana Reyes', email: 'ana@example.test', program: 'BSIT', role: 'STUDENT', organizations: [] }]);
    mocks.createInvoice.mockResolvedValue({ data: {} });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add student charge' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add student charge' });
    expect(screen.queryByRole('button', { name: 'Add student charge' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add charge' })).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Student' }), { target: { value: 'ana' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Ana Reyes/ }));
    fireEvent.change(within(dialog).getByLabelText(/Amount due/), { target: { value: '150' } });
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: 'Organization fee' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add charge' }));

    await waitFor(() => expect(mocks.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ student_id: 2026001, amount_due: '150', description: 'Organization fee' })));
    expect(mocks.createInvoice.mock.calls[0][0]).not.toHaveProperty('student');
  });

  it('explains where accounts come from and links to the members page on first use', async () => {
    renderPage();

    expect(await screen.findByText('No student accounts yet')).toBeInTheDocument();
    expect(screen.getByText(/Add members first, then use Add student charge above/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add members' })).toHaveAttribute('href', '/dashboard/admin/users');
  });

  it('offers Clear filters when a search hides every account, and the reset clears it', async () => {
    renderPage();
    await screen.findByText('No student accounts yet');

    fireEvent.change(screen.getByPlaceholderText('Name, school ID, email, course...'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No student accounts match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByPlaceholderText('Name, school ID, email, course...')).toHaveValue('');
    expect(await screen.findByText('No student accounts yet')).toBeInTheDocument();
  });

  describe('charging every member', () => {
    const preview = (overrides) => ({ data: { preview: true, members: 12, to_charge: 9, skipped: 0, already_paid: 3, total: 2700, ...overrides } });

    async function fillEveryMember() {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Add student charge' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add student charge' });
      fireEvent.click(within(dialog).getByText('Every member'));
      fireEvent.change(within(dialog).getByLabelText(/Amount due/), { target: { value: '300' } });
      fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: 'Organization fee' } });
      return dialog;
    }

    it('says how many already paid it and will be skipped while the tick is off', async () => {
      mocks.createInvoice.mockResolvedValue(preview());
      const dialog = await fillEveryMember();

      expect(await within(dialog).findByText('3 already paid it and will be skipped.')).toBeInTheDocument();
      expect(within(dialog).getByRole('checkbox', { name: 'Charge members who already paid a charge with this name' })).not.toBeChecked();
    });

    it('says they will be charged again once the tick is on, and says nothing when nobody already paid', async () => {
      mocks.createInvoice.mockResolvedValue(preview());
      const dialog = await fillEveryMember();
      await within(dialog).findByText('3 already paid it and will be skipped.');

      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Charge members who already paid a charge with this name' }));
      expect(await within(dialog).findByText('3 already paid it and will be charged again.')).toBeInTheDocument();

      fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: 'Another fee' } });
      mocks.createInvoice.mockResolvedValue(preview({ already_paid: 0 }));
      await waitFor(() => expect(within(dialog).getByText(/9 members will be charged/)).toBeInTheDocument());
      await waitFor(() => expect(within(dialog).queryByText(/already paid it/)).not.toBeInTheDocument());
    });
  });

  it('asks for five accounts a page on a phone and keeps the pager for the rest', async () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
    try {
      renderPage();
      await waitFor(() => expect(mocks.getStudentDebts).toHaveBeenCalledWith(expect.objectContaining({ per_page: 5, page: 1 })));
      expect(mocks.getStudentDebts).not.toHaveBeenCalledWith(expect.objectContaining({ per_page: 10 }));
    } finally { window.matchMedia = original; }
  });

  it('says one student with a balance in the singular and keeps View account on one line', async () => {
    const account = accountWith([invoice()]);
    mocks.getStudentDebts.mockResolvedValue({ data: { data: [account], summary: { total_outstanding: 300, students_owing: 1, students_cleared: 0, students_overdue: 0, total_students: 1 }, filter_options: { departments: [], programs: [], year_levels: [] }, total: 1, per_page: 10, current_page: 1 } });
    renderPage();

    expect(await screen.findByText('1 student with a balance')).toBeInTheDocument();
    expect(screen.getByText('Out of 1 student')).toBeInTheDocument();
    for (const button of await screen.findAllByRole('button', { name: 'View account' })) expect(button).toHaveClass('whitespace-nowrap');
  });
});
