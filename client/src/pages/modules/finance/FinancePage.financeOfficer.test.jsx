import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancePage from './FinancePage';

const financeMocks = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  getTransactionSummary: vi.fn(),
  getPersonalReceipts: vi.fn(),
  getInvoices: vi.fn(),
  getForecasts: vi.fn(),
  getBudgets: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  submitBudget: vi.fn(),
  getFinancialReports: vi.fn(),
  getReportChecks: vi.fn(),
  explainReportChecks: vi.fn(),
}));

vi.mock('../../../services/financeService', () => ({
  ...financeMocks,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  archiveTransaction: vi.fn(),
  deleteBudget: vi.fn(),
  deleteForecast: vi.fn(),
  generateForecast: vi.fn(),
  generateBudgetAdvice: vi.fn(),
  createBudget: financeMocks.createBudget,
  updateBudget: financeMocks.updateBudget,
  submitBudget: financeMocks.submitBudget,
  getFinancialReport: vi.fn(),
  generateFinancialReport: vi.fn(),
  submitFinancialReport: vi.fn(),
  ignoreReportCheck: vi.fn(),
  downloadFinancialReportPdf: vi.fn(),
}));

vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: vi.fn(() => Promise.resolve({ data: [] })) }));

const eventMocks = vi.hoisted(() => ({ getEvents: vi.fn() }));
vi.mock('../../../services/eventService', () => eventMocks);

const TREASURER = { role: 'SBO_OFFICER', can_handle_finance: true };
const OFFICER = { role: 'SBO_OFFICER', can_handle_finance: false };
const ADMIN = { role: 'ADMIN' };

function renderPage(user, route, props) {
  localStorage.setItem('user', JSON.stringify(user));
  return render(
    <MemoryRouter initialEntries={[route]}>
      <FinancePage {...props} />
    </MemoryRouter>,
  );
}

const LEDGER = '/dashboard/finance/financial-ledger';
const BUDGETS = '/dashboard/finance/budget-allocation';
const REPORTS = '/dashboard/finance/transaction-history';
const FORECAST = '/dashboard/finance/financial-insights';

const budget = (overrides) => ({
  id: 5, title: 'Sports fest budget', allocated_amount: 5000, remaining_amount: 4000, warning_threshold: 1000,
  approval_status: 'pending', submission_status: 'pending_department_head', event_id: null, financial_semester_id: null, ...overrides,
});

const forecast = (overrides) => ({
  id: 31, forecast_period: '2099-01', predicted_income: 1000, predicted_expense: 500, summary_text: 'Steady', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  financeMocks.getTransactions.mockResolvedValue({
    data: { data: [{ id: 1, description: 'Booth rental', amount: 250, type: 'expense', category: 'Operations', transaction_date: '2026-08-01' }], current_page: 1, last_page: 1, total: 1, per_page: 10 },
  });
  financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 0, total_expense: 250, net_balance: -250 } });
  financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
  financeMocks.getInvoices.mockResolvedValue({ data: [] });
  financeMocks.getForecasts.mockResolvedValue({ data: [] });
  financeMocks.getBudgets.mockResolvedValue({ data: [] });
  financeMocks.createBudget.mockResolvedValue({ data: {} });
  financeMocks.updateBudget.mockResolvedValue({ data: {} });
  financeMocks.submitBudget.mockResolvedValue({ data: {} });
  financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
  financeMocks.getReportChecks.mockResolvedValue({ data: { findings: [] } });
  eventMocks.getEvents.mockResolvedValue({ data: [] });
});

describe('Finance for an officer whose position handles finance', () => {
  it('records and edits ledger entries, as an Admin does', async () => {
    renderPage(TREASURER, LEDGER, { initialTab: 'transactions' });
    expect(await screen.findByRole('button', { name: 'Record transaction' })).toBeInTheDocument();
    expect(await findRowAction('Edit transaction', 'Booth rental')).toBeInTheDocument();
  });

  it('keeps the ledger view only when the position does not handle finance', async () => {
    renderPage(OFFICER, LEDGER, { initialTab: 'transactions' });
    expect((await screen.findAllByText('Booth rental')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Record transaction' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Actions for Booth rental/ })).not.toBeInTheDocument();
  });

  it('proposes budgets and asks for advice, with delete budget switched off', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ id: 5, title: 'Pending budget' }), budget({ id: 6, title: 'Approved budget', approval_status: 'approved', submission_status: 'approved' })] });
    renderPage(TREASURER, BUDGETS, { initialTab: 'budgets' });
    expect(await screen.findByRole('button', { name: 'Propose budget' })).toBeInTheDocument();
    expect(await findRowAction('Get advice', 'Approved budget')).toBeInTheDocument();
    expect(await findRowAction('Delete budget', 'Pending budget')).toBeDisabled();
  });

  it('lets an Admin still delete a budget that is not approved', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ id: 5, title: 'Pending budget' })] });
    renderPage(ADMIN, BUDGETS, { initialTab: 'budgets' });
    expect(await findRowAction('Delete budget', 'Pending budget')).toBeInTheDocument();
  });

  it('keeps the budgets view only for an officer without the switch', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ id: 6, title: 'Approved budget', approval_status: 'approved', submission_status: 'approved' })] });
    renderPage(OFFICER, BUDGETS, { initialTab: 'budgets' });
    expect((await screen.findAllByText('Approved budget')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Propose budget' })).toBeDisabled();
    await findRowAction('View details for Approved budget', 'Approved budget');
    expect(screen.queryByRole('menuitem', { name: 'Get advice' })).not.toBeInTheDocument();
  });

  it('generates a forecast, with delete forecast switched off', async () => {
    financeMocks.getForecasts.mockResolvedValue({ data: [forecast()] });
    renderPage(TREASURER, FORECAST, { initialTab: 'forecasting' });
    expect(await screen.findByRole('button', { name: 'Generate forecast' })).toBeInTheDocument();
    expect(await findRowAction('Delete forecast', 'Steady')).toBeDisabled();
  });

  it('prepares a report but never submits it to the Department Head', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [{ id: 61, title: 'August report', summary_text: 'Saved facts', document_type: 'financial_report', submission_status: 'draft', generated_at: '2026-08-31' }] });
    renderPage(TREASURER, REPORTS, { initialTab: 'reports' });
    expect(await screen.findByRole('button', { name: 'Prepare a report' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Saved reports' });
    expect(within(list).getByText('August report')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
  });

  it('keeps reports view only for an officer without the switch', async () => {
    renderPage(OFFICER, REPORTS, { initialTab: 'reports' });
    expect(await screen.findByText('No saved reports to show yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare a report' })).toBeDisabled();
  });
});

describe('Budgets are drafts until the Admin submits them', () => {
  async function fillBudgetForm() {
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Foundation week' } });
    fireEvent.change(screen.getByLabelText('Allocated amount (₱)'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Warning threshold (₱)'), { target: { value: '80' } });
  }

  it('saves a treasurer proposal as a draft, and the button says so', async () => {
    renderPage(TREASURER, BUDGETS, { initialTab: 'budgets' });
    fireEvent.click(await screen.findByRole('button', { name: 'Propose budget' }));
    await fillBudgetForm();

    expect(screen.queryByRole('button', { name: /Submit for approval/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(financeMocks.createBudget).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Budget saved as a draft. Your Admin submits it for approval.')).toBeInTheDocument();
  });

  it('keeps Submit for approval on the Admin form', async () => {
    renderPage(ADMIN, BUDGETS, { initialTab: 'budgets' });
    fireEvent.click(await screen.findByRole('button', { name: 'Propose budget' }));
    await fillBudgetForm();

    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(financeMocks.createBudget).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Budget proposal submitted for approval.')).toBeInTheDocument();
  });

  it('lets the Admin submit a draft from its detail drawer', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ id: 8, title: 'Drafted budget', approval_status: null, submission_status: 'draft' })] });
    renderPage(ADMIN, BUDGETS, { initialTab: 'budgets' });
    fireEvent.click(await findRowAction('View details for Drafted budget', 'Drafted budget'));

    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(financeMocks.submitBudget).toHaveBeenCalledWith(8));
  });

  it('shows a treasurer an Edit draft button, never Edit and resubmit', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ id: 8, title: 'Drafted budget', approval_status: null, submission_status: 'draft' }), budget({ id: 9, title: 'Returned budget', approval_status: 'rejected', submission_status: 'rejected' })] });
    renderPage(TREASURER, BUDGETS, { initialTab: 'budgets' });
    fireEvent.click(await findRowAction('View details for Drafted budget', 'Drafted budget'));

    expect(await screen.findByRole('button', { name: 'Edit draft' })).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Submit for approval|Edit and resubmit/ })).not.toBeInTheDocument();
  });

  it('saves a treasurer edit of a draft as a draft', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ id: 8, title: 'Drafted budget', approval_status: null, submission_status: 'draft' })] });
    renderPage(TREASURER, BUDGETS, { initialTab: 'budgets' });
    fireEvent.click(await findRowAction('View details for Drafted budget', 'Drafted budget'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(financeMocks.updateBudget).toHaveBeenCalledWith(8, expect.objectContaining({ title: 'Drafted budget' })));
    expect(await screen.findByText('Draft saved. Your Admin submits it for approval.')).toBeInTheDocument();
  });
});

describe('Report drawer for a finance officer', () => {
  it('shows Submit switched off with its reason, as every other Admin only step', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [{ id: 61, title: 'August report', summary_text: 'Saved facts', document_type: 'financial_report', submission_status: 'draft', generated_at: '2026-08-31' }] });
    renderPage(TREASURER, REPORTS, { initialTab: 'reports' });
    fireEvent.click(await findRowAction('View details for August report', 'August report'));

    expect(await screen.findByRole('button', { name: 'Submit for review' })).toBeDisabled();
    expect(screen.getByText('An Admin submits reports')).toBeInTheDocument();
  });
});
