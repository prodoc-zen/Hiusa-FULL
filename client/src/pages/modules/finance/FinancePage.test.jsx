import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancePage from './FinancePage';

const financeMocks = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  getTransactionSummary: vi.fn(),
  getPersonalReceipts: vi.fn(),
  getInvoices: vi.fn(),
  getAuditLogs: vi.fn(),
  getForecasts: vi.fn(),
  getBudgets: vi.fn(),
  createBudget: vi.fn(),
  getFinancialReports: vi.fn(),
  getFinancialReport: vi.fn(),
  getFinancialSemesters: vi.fn(),
  createFinancialSemester: vi.fn(),
  generateFinancialReport: vi.fn(),
  downloadFinancialReportPdf: vi.fn(),
  submitFinancialReport: vi.fn(),
  deleteBudget: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('../../../services/financeService', () => ({
  ...financeMocks,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  generateForecast: vi.fn(),
  createBudget: financeMocks.createBudget,
  generateBudgetAdvice: vi.fn(),
  generateFinancialReport: financeMocks.generateFinancialReport,
  downloadFinancialReportPdf: financeMocks.downloadFinancialReportPdf,
  submitFinancialReport: financeMocks.submitFinancialReport,
}));

const collegeMocks = vi.hoisted(() => ({ getCollegeOrganizations: vi.fn() }));
vi.mock('../../../services/collegeOrganizationService', () => collegeMocks);

vi.mock('../../../services/eventService', () => ({
  getEvents: vi.fn(() => Promise.resolve({ data: [] })),
}));

describe('FinancePage transaction search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    financeMocks.getTransactions.mockResolvedValue({
      data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 },
    });
    financeMocks.getTransactionSummary.mockResolvedValue({
      data: { total_income: 0, total_expense: 0, net_balance: 0 },
    });
    financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
    financeMocks.getInvoices.mockResolvedValue({ data: [] });
    financeMocks.getAuditLogs.mockResolvedValue({ data: { data: [] } });
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    financeMocks.getBudgets.mockResolvedValue({ data: [] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [] });
  });

  it('clears the search term and reloads the unfiltered ledger', async () => {
    render(<FinancePage initialTab="transactions" />);

    const search = await screen.findByPlaceholderText('Search transactions...');
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalledWith({ page: 1 }));

    fireEvent.change(search, { target: { value: 'rent' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith({ page: 1, search: 'rent' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(search).toHaveValue('');
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith({ page: 1 }));
  });

  it('keeps the record action visible and offers a reset for an empty filtered ledger', async () => {
    render(<FinancePage initialTab="transactions" />);

    expect(await screen.findByRole('button', { name: 'Record transaction' })).toBeInTheDocument();
    const search = screen.getByPlaceholderText('Search transactions...');
    fireEvent.change(search, { target: { value: 'missing' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(await screen.findByText('No matching transactions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(search).toHaveValue('');
  });

  it('shows the complete traceable data for each digital-ledger entry', async () => {
    financeMocks.getTransactions.mockResolvedValue({
      data: {
        data: [{
          id: 7,
          transaction_date: '2026-09-08T10:30:00.000000Z',
          description: 'Venue reservation',
          category: 'Events',
          type: 'expense',
          amount: 2500,
          receipt_reference: 'HIUSA-1-00000007',
          event: { id: 3, title: 'Sports Fest' },
          budget: { id: 4, title: 'Sports Fest Budget' },
          payer: { school_id: 101, first_name: 'Ana', last_name: 'Reyes' },
          recorder: { school_id: 102, first_name: 'Marco', last_name: 'Santos' },
        }],
        current_page: 1,
        last_page: 1,
        total: 1,
        per_page: 10,
      },
    });

    render(<FinancePage initialTab="transactions" />);

    const ledgerTable = await screen.findByRole('table');
    expect(within(ledgerTable).getByText('Venue reservation')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('Sep 8, 2026')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('HIUSA-1-00000007')).toBeInTheDocument();
    const mobileLedger = screen.getByRole('list', { name: 'Transactions' });
    expect(within(mobileLedger).getByText('Venue reservation')).toBeInTheDocument();
    expect(within(mobileLedger).getByRole('button', { name: 'Edit transaction' })).toBeInTheDocument();
    expect(screen.getAllByText('Sports Fest').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sports Fest Budget').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recorded by Marco Santos/).length).toBeGreaterThan(0);
  });

  it('opens complete personal receipt details and can close them', async () => {
    financeMocks.getPersonalReceipts.mockResolvedValue({
      data: [{
        id: 9,
        transaction_date: '2026-09-08T10:30:00.000000Z',
        description: 'Membership payment',
        category: 'Membership',
        type: 'income',
        amount: 750,
        receipt_reference: 'HIUSA-1-00000009',
        receipt_file_url: '/storage/receipts/receipt-9.pdf',
        event: { id: 3, title: 'General Assembly' },
        budget: { id: 4, title: 'Operating Budget' },
        payer: { school_id: 101, first_name: 'Ana', last_name: 'Reyes' },
        recorder: { school_id: 102, first_name: 'Marco', last_name: 'Santos' },
      }],
    });

    render(<FinancePage initialTab="receipts" />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Receipt' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('HIUSA-1-00000009').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('General Assembly')).toBeInTheDocument();
    expect(within(dialog).getByText('Operating Budget')).toBeInTheDocument();
    expect(within(dialog).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(dialog).getByText('Marco Santos')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open receipt file' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads a student\'s own receipts without requesting restricted reporting data', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    financeMocks.getPersonalReceipts.mockResolvedValue({
      data: [{
        id: 10,
        transaction_date: '2026-09-09T10:30:00.000000Z',
        description: 'Student membership payment',
        category: 'Membership',
        type: 'income',
        amount: 500,
        receipt_reference: 'HIUSA-1-00000010',
      }],
    });
    render(<FinancePage initialTab="receipts" />);

    expect(await screen.findByText('Student membership payment')).toBeInTheDocument();
    expect(screen.getByText('HIUSA-1-00000010')).toBeInTheDocument();
    expect(financeMocks.getFinancialReports).not.toHaveBeenCalled();
    expect(screen.queryByText('Net balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load financial data.')).not.toBeInTheDocument();
  });

  it('opens the budget proposal form when launched from the request selector', async () => {
    render(<FinancePage initialTab="budgets" startBudgetProposal />);

    expect(await screen.findByRole('heading', { name: 'Propose Budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeInTheDocument();
  });

  it('lets a Department Head review budgets read-only, without any write controls', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    financeMocks.getBudgets.mockResolvedValue({
      data: [{ id: 1, title: 'Operating Budget', allocated_amount: 5000, remaining_amount: 4000, warning_threshold: 1000, approval_status: 'approved' }],
    });

    render(<FinancePage initialTab="budgets" startBudgetProposal />);

    expect(await screen.findByText('Operating Budget')).toBeInTheDocument();
    expect(screen.getByText(/View only\./)).toBeInTheDocument();
    expect(financeMocks.getBudgets).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Propose Budget' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI Advice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Propose Budget' })).not.toBeInTheDocument();
  });

  it('shows an SBO officer the forecasts without the admin-only generate action', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));

    render(<FinancePage initialTab="forecasting" />);

    expect(await screen.findByText('No forecasts recorded yet.')).toBeInTheDocument();
    expect(financeMocks.getForecasts).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Generate Forecast/ })).not.toBeInTheDocument();
  });

  it('creates an income statement as a separate document with a letterhead image', async () => {
    financeMocks.generateFinancialReport.mockResolvedValue({
      data: {
        report: { id: 41, document_type: 'income_statement', title: 'Income Statement - Semester 2026-2027', summary_text: 'Recorded totals for the selected period.' },
        totals: { income: 1000, expense: 250, balance: 750, opening_balance: 0, closing_balance: 750 },
        transactions: [],
        audit_logs: [],
        budget_advisories: [],
        latest_ols_forecast: null,
        ai_summary_status: 'generated',
      },
    });

    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [{ id: 3, name: 'Semester 2026-2027', starts_on: '2026-06-01', ends_on: '2026-09-27' }] });
    render(<FinancePage initialTab="reports" />);

    fireEvent.click(await screen.findByRole('radio', { name: /Income Statement/i }));
    await screen.findByRole('option', { name: /Semester 2026-2027/ });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Semester' }), { target: { value: '3' } });
    expect(screen.getByLabelText('Letter body')).toBeInTheDocument();
    const header = new File(['header'], 'organization-header.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Letterhead image'), { target: { files: [header] } });
    fireEvent.change(screen.getByPlaceholderText('Treasurer full name'), { target: { value: 'Taylor Treasurer' } });
    fireEvent.change(screen.getByPlaceholderText('President full name'), { target: { value: 'Pat President' } });
    fireEvent.change(screen.getByPlaceholderText('Adviser full name'), { target: { value: 'Alex Adviser' } });
    fireEvent.change(screen.getByPlaceholderText('SBO Adviser full name'), { target: { value: 'Sam SBO Adviser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Income Statement' }));

    await waitFor(() => expect(financeMocks.generateFinancialReport).toHaveBeenCalledWith(expect.objectContaining({
      document_type: 'income_statement',
      report_type: 'semester',
      financial_semester_id: '3',
      letterhead: header,
    })));
    expect((await screen.findAllByText('Income Statement - Semester 2026-2027')).length).toBeGreaterThan(0);
  });

  it('sends the selected custom date range when generating a report', async () => {
    financeMocks.generateFinancialReport.mockResolvedValue({ data: {
      report: { id: 52, document_type: 'financial_report', title: 'Custom Financial Report', summary_text: 'Recorded totals.' },
      totals: { income: 0, expense: 0, balance: 0, closing_balance: 0 }, transactions: [], audit_logs: [], budget_advisories: [],
    } });
    render(<FinancePage initialTab="reports" />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Covered period' }), { target: { value: 'custom' } });
    fireEvent.change(screen.getAllByLabelText('Start date').at(-1), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getAllByLabelText('End date').at(-1), { target: { value: '2026-08-31' } });
    for (const title of ['Treasurer', 'President', 'Adviser', 'SBO Adviser']) {
      fireEvent.change(screen.getByPlaceholderText(`${title} full name`), { target: { value: `${title} Name` } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Generate Financial Report' }));
    await waitFor(() => expect(financeMocks.generateFinancialReport).toHaveBeenCalledWith(expect.objectContaining({
      report_type: 'custom', period_start: '2026-08-01', period_end: '2026-08-31', event_id: null, financial_semester_id: null,
    })));
  });

  it('exports a saved report using its saved ledger details', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [{ id: 61, title: 'August report', summary_text: 'Saved facts', document_type: 'financial_report', submission_status: 'draft' }] });
    financeMocks.getFinancialReport.mockResolvedValue({ data: {
      report: { opening_balance_snapshot: '20.00', custody_snapshot: { verified_collections: 100, recorded_remittances: 40 } },
      totals: { opening_balance: 20, income: 100, expense: 0, balance: 100, closing_balance: 120 },
      cash_advances: { released: 0, repayments: 0 },
      transactions: [{ id: 7, type: 'income', category: 'Fees', amount: '100.00', description: 'Membership', transaction_date: '2026-08-12' }],
    } });
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<FinancePage initialTab="reports" />);
    await screen.findByText('August Report');
    fireEvent.click(screen.getAllByRole('button', { name: 'Export Excel' }).at(-1));
    await waitFor(() => expect(financeMocks.getFinancialReport).toHaveBeenCalledWith(61));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled(), { timeout: 12000 });
    expect(URL.createObjectURL.mock.calls[0][0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbookBuffer = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(URL.createObjectURL.mock.calls[0][0]);
    });
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    expect(workbook.getWorksheet('Report').getColumn(3).values).toContain('Membership');
    expect(workbook.getWorksheet('Report').getColumn(4).values).toContain(100);
    expect(workbook.getWorksheet('Report').getColumn(4).numFmt).toBe('"₱"#,##0.00');
    expect(click).toHaveBeenCalled();
    expect(click.mock.instances[0].download).toBe('hiusa-financial-report-61.xlsx');
    click.mockRestore();
  }, 15000);

  it('exports cash advances in their own section, apart from income and expense', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [{ id: 62, title: 'October report', summary_text: 'Saved facts', document_type: 'financial_report', submission_status: 'draft' }] });
    financeMocks.getFinancialReport.mockResolvedValue({ data: {
      report: { opening_balance_snapshot: '0.00', custody_snapshot: { verified_collections: 0, recorded_remittances: 0 } },
      totals: { opening_balance: 0, income: 1000, expense: 325, balance: 675, closing_balance: 375 },
      cash_advances: { released: 500, repayments: 200 },
      transactions: [
        { id: 7, type: 'income', category: 'Membership', amount: '1000.00', description: 'Fees', transaction_date: '2026-10-05', cash_advance: null },
        { id: 8, type: 'expense', category: 'Cash Advance', amount: '500.00', description: 'Cash advance ADV-1', transaction_date: '2026-10-06', cash_advance: 'release' },
        { id: 9, type: 'income', category: 'Cash Advance Repayment', amount: '200.00', description: 'Repayment for ADV-1', transaction_date: '2026-10-06', cash_advance: 'repayment' },
      ],
    } });
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<FinancePage initialTab="reports" />);
    await screen.findByText('October Report');
    fireEvent.click(screen.getAllByRole('button', { name: 'Export Excel' }).at(-1));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled(), { timeout: 12000 });
    const workbookBuffer = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(URL.createObjectURL.mock.calls[0][0]);
    });
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    const rows = [];
    workbook.getWorksheet('Report').eachRow((row, number) => {
      if (number > 1) rows.push({ section: row.getCell(1).value, item: row.getCell(2).value, amount: row.getCell(4).value });
    });
    const amountOf = (section, item) => rows.find((row) => row.section === section && row.item === item)?.amount;
    expect(amountOf('Totals', 'Income')).toBe(1000);
    expect(amountOf('Totals', 'Expenses')).toBe(325);
    expect(amountOf('Totals', 'Net activity')).toBe(675);
    expect(amountOf('Totals', 'Closing balance')).toBe(375);
    expect(amountOf('Cash advances', 'Cash advances released')).toBe(500);
    expect(amountOf('Cash advances', 'Cash advance repayments')).toBe(200);
    expect(amountOf('Cash advance entry', 'Cash Advance (expense)')).toBe(500);
    expect(amountOf('Cash advance entry', 'Cash Advance Repayment (income)')).toBe(200);
    expect(amountOf('Ledger transaction', 'Membership (income)')).toBe(1000);
    click.mockRestore();
  }, 15000);

  it('shows the cash advances beside a generated report without adding them to income or expense', async () => {
    financeMocks.generateFinancialReport.mockResolvedValue({ data: {
      report: { id: 53, document_type: 'financial_report', title: 'October Financial Report', summary_text: 'Recorded totals.' },
      totals: { income: 1000, expense: 325, balance: 675, opening_balance: 0, closing_balance: 375 },
      cash_advances: { released: 500, repayments: 200 },
      transactions: [], audit_logs: [], budget_advisories: [],
    } });
    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [{ id: 3, name: 'Semester 2026-2027', starts_on: '2026-06-01', ends_on: '2026-09-27' }] });
    render(<FinancePage initialTab="reports" />);
    await screen.findByRole('option', { name: /Semester 2026-2027/ });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Semester' }), { target: { value: '3' } });
    for (const title of ['Treasurer', 'President', 'Adviser', 'SBO Adviser']) {
      fireEvent.change(screen.getByPlaceholderText(`${title} full name`), { target: { value: `${title} Name` } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Generate Financial Report' }));

    expect(await screen.findByText(/Cash advances released:/, {}, { timeout: 8000 })).toHaveTextContent('Cash advances released: ₱500.00 · Cash advance repayments: ₱200.00. Money lent out and returned is not income or expense.');
    expect(screen.getByText('Income')).toHaveTextContent('₱1,000.00');
    expect(screen.getByText('Expenses')).toHaveTextContent('₱325.00');
  // Rendering the generated report can outlast the default waits under a full parallel run.
  }, 15000);

  it('submits a budget for the selected financial semester', async () => {
    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [{ id: 3, name: 'First Semester' }] });
    financeMocks.createBudget.mockResolvedValue({ data: { id: 9 } });
    render(<FinancePage initialTab="budgets" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Propose Budget' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Sports Fest 2026 Budget'), { target: { value: 'First Semester Allocation' } });
    const [amount, threshold] = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(amount, { target: { value: '1500' } });
    fireEvent.change(threshold, { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Financial semester (optional)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));

    await waitFor(() => expect(financeMocks.createBudget).toHaveBeenCalledWith(expect.objectContaining({
      title: 'First Semester Allocation', financial_semester_id: '3', allocated_amount: 1500,
    })));
  // Loading exceljs and building the workbook can outlast the default 5s under a full parallel run.
  }, 20000);
});

describe('FinancePage deleting budgets and transactions', () => {
  const budget = { id: 4, title: 'Sports Fest Budget', allocated_amount: 5000, remaining_amount: 4000, warning_threshold: 1000, approval_status: 'approved' };
  const transaction = { id: 7, transaction_date: '2026-09-08T10:30:00.000000Z', description: 'Venue reservation', category: 'Events', type: 'expense', amount: 2500 };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    financeMocks.getTransactions.mockResolvedValue({ data: { data: [transaction], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 0, total_expense: 2500, net_balance: -2500 } });
    financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
    financeMocks.getInvoices.mockResolvedValue({ data: [] });
    financeMocks.getAuditLogs.mockResolvedValue({ data: { data: [] } });
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    financeMocks.getBudgets.mockResolvedValue({ data: [budget] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [] });
  });

  async function confirmBudgetDelete() {
    render(<FinancePage initialTab="budgets" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this budget?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete budget' }));
  }

  async function confirmTransactionDelete() {
    render(<FinancePage initialTab="transactions" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete transaction' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Delete this transaction?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete transaction' }));
  }

  it('deletes a budget after confirmation and reloads the budgets', async () => {
    financeMocks.deleteBudget.mockResolvedValue({ data: { message: 'Budget deleted successfully.' } });
    await confirmBudgetDelete();

    await waitFor(() => expect(financeMocks.deleteBudget).toHaveBeenCalledWith(4));
    await waitFor(() => expect(financeMocks.getBudgets).toHaveBeenCalledTimes(2));
  });

  it('shows the server message when a budget already has transactions', async () => {
    financeMocks.deleteBudget.mockRejectedValue({ response: { status: 409, data: { message: 'Cannot delete a budget that has existing transactions. Remove all transactions first.' } } });
    await confirmBudgetDelete();

    const dialog = await screen.findByRole('dialog', { name: 'Delete this budget?' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cannot delete a budget that has existing transactions. Remove all transactions first.');
    expect(financeMocks.getBudgets).toHaveBeenCalledTimes(1);
  });

  it('deletes a transaction after confirmation and reloads the ledger', async () => {
    financeMocks.deleteTransaction.mockResolvedValue({ data: { message: 'Transaction deleted successfully.' } });
    await confirmTransactionDelete();

    await waitFor(() => expect(financeMocks.deleteTransaction).toHaveBeenCalledWith(7));
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalledTimes(2));
  });

  it('shows the server message for a ledger entry owned by another module', async () => {
    financeMocks.deleteTransaction.mockRejectedValue({ response: { status: 409, data: { message: 'This entry was recorded when collection COL-1 was verified. Change it from Collections.' } } });
    await confirmTransactionDelete();

    const dialog = await screen.findByRole('dialog', { name: 'Delete this transaction?' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Change it from Collections.');
  });

  it('hides delete controls from roles that cannot write finance', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    render(<FinancePage initialTab="budgets" />);
    await screen.findByText('Sports Fest Budget');
    expect(screen.queryByRole('button', { name: 'Delete budget' })).not.toBeInTheDocument();
  });
});

describe('FinancePage forecast explainability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    financeMocks.getTransactions.mockResolvedValue({
      data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 },
    });
    financeMocks.getTransactionSummary.mockResolvedValue({
      data: { total_income: 0, total_expense: 0, net_balance: 0 },
    });
    financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
    financeMocks.getInvoices.mockResolvedValue({ data: [] });
    financeMocks.getAuditLogs.mockResolvedValue({ data: { data: [] } });
    financeMocks.getBudgets.mockResolvedValue({ data: [] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [] });
  });

  it('shows a weak-fit warning and reports an unknown engine when the forecast metadata is thin', async () => {
    financeMocks.getForecasts.mockResolvedValue({
      data: [{
        id: 1,
        forecast_period: '2026-09',
        predicted_income: 1000,
        predicted_expense: 800,
        predicted_balance: 200,
        safe_spending_limit: 160,
        model_details: { sample_months: 2, income: { r_squared: 0.2 }, expense: { r_squared: 0.3 } },
      }],
    });

    render(<FinancePage initialTab="forecasting" />);

    expect(await screen.findByText('Engine not reported')).toBeInTheDocument();
    expect(await screen.findByText(/Treat this projection as directional only/i)).toBeInTheDocument();
  });

  it('shows the reporting engine and skips the weak-fit warning for a well-fit forecast', async () => {
    financeMocks.getForecasts.mockResolvedValue({
      data: [{
        id: 2,
        forecast_period: '2026-09',
        predicted_income: 5000,
        predicted_expense: 3000,
        predicted_balance: 2000,
        safe_spending_limit: 1600,
        model_details: { sample_months: 6, engine: 'python-fastapi', income: { r_squared: 0.95 }, expense: { r_squared: 0.9 } },
      }],
    });

    render(<FinancePage initialTab="forecasting" />);

    expect(await screen.findByText('Python AI service')).toBeInTheDocument();
    expect(screen.queryByText(/Treat this projection as directional only/i)).not.toBeInTheDocument();
  });

  it('shows a specific, retryable message when generating a forecast fails with too little history', async () => {
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    const { generateForecast } = await import('../../../services/financeService');
    generateForecast.mockRejectedValue({ response: { status: 422, data: { message: 'Not enough history.' } } });

    render(<FinancePage initialTab="forecasting" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Forecast' }));

    expect((await screen.findAllByText(/Not enough history/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('FinancePage organization scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    financeMocks.getTransactions.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } });
    financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 0, total_expense: 0, net_balance: 0 } });
    financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
    financeMocks.getInvoices.mockResolvedValue({ data: [] });
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    financeMocks.getBudgets.mockResolvedValue({ data: [] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
    collegeMocks.getCollegeOrganizations.mockResolvedValue({ data: { data: [{ id: 7, name: 'Chess Club' }, { id: 8, name: 'Drama Guild' }], current_page: 1, last_page: 1, per_page: 100, total: 2 } });
  });

  it('lets a Department Head narrow every finance read to one organization', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    render(<FinancePage initialTab="transactions" />);

    const select = await screen.findByLabelText('Organization');
    await screen.findByRole('option', { name: 'Chess Club' });
    expect(select).toHaveValue('');
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalledWith({ page: 1 }));

    fireEvent.change(select, { target: { value: '7' } });

    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith({ page: 1, organization_id: '7' }));
    expect(financeMocks.getTransactionSummary).toHaveBeenLastCalledWith({ organization_id: '7' });
    expect(financeMocks.getBudgets).toHaveBeenLastCalledWith(expect.objectContaining({ organization_id: '7' }));
    expect(financeMocks.getForecasts).toHaveBeenLastCalledWith(expect.objectContaining({ organization_id: '7' }));
    expect(financeMocks.getFinancialReports).toHaveBeenLastCalledWith(expect.objectContaining({ organization_id: '7' }));
  });

  it('does not offer the organization select or load the college for other roles', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    render(<FinancePage initialTab="transactions" />);

    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalled());
    expect(screen.queryByLabelText('Organization')).not.toBeInTheDocument();
    expect(collegeMocks.getCollegeOrganizations).not.toHaveBeenCalled();
  });
});

describe('FinancePage rows the server will not let the ledger change', () => {
  const base = { transaction_date: '2026-09-08T10:30:00.000000Z', category: 'Fees', type: 'income', amount: 100, is_system_generated: false, system_source: null, system_source_label: null, is_locked_by_report: false, locking_report_title: null };
  const rows = [
    { ...base, id: 1, description: 'Manual supplies' },
    { ...base, id: 2, description: 'Verified dues', is_system_generated: true, system_source: 'collection', system_source_label: 'Collection verification' },
    { ...base, id: 3, description: 'Reported venue', is_locked_by_report: true, locking_report_title: 'August report' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    financeMocks.getTransactions.mockResolvedValue({ data: { data: rows, current_page: 1, last_page: 1, total: 3, per_page: 10 } });
    financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 300, total_expense: 0, net_balance: 300 } });
    financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
    financeMocks.getInvoices.mockResolvedValue({ data: [] });
    financeMocks.getAuditLogs.mockResolvedValue({ data: { data: [] } });
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    financeMocks.getBudgets.mockResolvedValue({ data: [] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
    financeMocks.getFinancialSemesters.mockResolvedValue({ data: [] });
  });

  it('keeps Edit and Delete only on the manual row of the mobile list', async () => {
    render(<FinancePage initialTab="transactions" />);

    const mobileLedger = await screen.findByRole('list', { name: 'Transactions' });
    const [manual, system, locked] = within(mobileLedger).getAllByRole('listitem');
    expect(within(manual).getByRole('button', { name: 'Edit transaction' })).toBeInTheDocument();
    expect(within(manual).getByRole('button', { name: 'Delete transaction' })).toBeInTheDocument();
    expect(within(system).queryByRole('button', { name: 'Edit transaction' })).not.toBeInTheDocument();
    expect(within(system).queryByRole('button', { name: 'Delete transaction' })).not.toBeInTheDocument();
    expect(within(system).getByText('Recorded by Collection verification. Change it there.')).toBeInTheDocument();
    expect(within(locked).queryByRole('button', { name: 'Edit transaction' })).not.toBeInTheDocument();
    expect(within(locked).queryByRole('button', { name: 'Delete transaction' })).not.toBeInTheDocument();
    expect(within(locked).getByText("In submitted report 'August report'. Return the report to change it.")).toBeInTheDocument();
  });

  it('shows the muted note instead of the row menu in the table for system and locked rows', async () => {
    render(<FinancePage initialTab="transactions" />);

    const table = await screen.findByRole('table');
    const [, manual, system, locked] = within(table).getAllByRole('row');
    expect(within(manual).getByRole('button', { name: 'Actions for Manual supplies' })).toBeInTheDocument();
    expect(within(system).queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(within(system).getByText('Recorded by Collection verification. Change it there.')).toBeInTheDocument();
    expect(within(locked).queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(within(locked).getByText("In submitted report 'August report'. Return the report to change it.")).toBeInTheDocument();
  });
});
