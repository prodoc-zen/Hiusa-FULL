import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
  updateBudget: vi.fn(),
  getFinancialReports: vi.fn(),
  getFinancialSemesters: vi.fn(),
  submitFinancialReport: vi.fn(),
}));

vi.mock('../../../services/financeService', () => ({
  ...financeMocks,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  deleteBudget: vi.fn(),
  generateForecast: vi.fn(),
  generateBudgetAdvice: vi.fn(),
  getFinancialReport: vi.fn(),
  createFinancialSemester: vi.fn(),
  generateFinancialReport: vi.fn(),
  downloadFinancialReportPdf: vi.fn(),
}));

vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: vi.fn(() => Promise.resolve({ data: [] })) }));

const eventMocks = vi.hoisted(() => ({ getEvents: vi.fn() }));
vi.mock('../../../services/eventService', () => eventMocks);

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

function renderPage(role, route, props = {}) {
  localStorage.setItem('user', JSON.stringify({ role }));
  return render(
    <MemoryRouter initialEntries={[route]}>
      <FinancePage {...props} />
      <Probe />
    </MemoryRouter>,
  );
}

const BUDGETS = '/dashboard/finance/budget-allocation';
const REPORTS = '/dashboard/finance/transaction-history';

const budget = (overrides) => ({
  id: 5, title: 'Sports fest budget', allocated_amount: 5000, remaining_amount: 4000, warning_threshold: 1000,
  approval_status: 'pending', submission_status: 'pending_department_head', event_id: null, financial_semester_id: null, ...overrides,
});

const report = (overrides) => ({
  id: 61, title: 'August report', summary_text: 'Saved facts', document_type: 'financial_report', submission_status: 'draft', generated_at: '2026-08-31', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  financeMocks.getTransactions.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } });
  financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 0, total_expense: 0, net_balance: 0 } });
  financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
  financeMocks.getInvoices.mockResolvedValue({ data: [] });
  financeMocks.getForecasts.mockResolvedValue({ data: [] });
  financeMocks.getBudgets.mockResolvedValue({ data: [] });
  financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
  financeMocks.getFinancialSemesters.mockResolvedValue({ data: [] });
  eventMocks.getEvents.mockResolvedValue({ data: [{ id: 3, title: 'Sports Fest' }, { id: 4, title: 'Foundation Day' }] });
});

describe('FinancePage titles', () => {
  it.each([
    ['transactions', '/dashboard/finance/financial-ledger', 'Ledger'],
    ['budgets', BUDGETS, 'Budgets'],
    ['reports', REPORTS, 'Financial reports'],
    ['forecasting', '/dashboard/finance/financial-insights', 'Forecast'],
  ])('the %s view has one h1 named like its menu item', async (initialTab, route, title) => {
    renderPage('ADMIN', route, { initialTab });

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/Transaction History/)).not.toBeInTheDocument();
  });

  it('puts the single primary action of each view in the header', async () => {
    renderPage('ADMIN', BUDGETS, { initialTab: 'budgets' });

    const primary = await screen.findByRole('button', { name: 'Propose budget' });
    expect(primary.closest('h1')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Propose budget' })).toHaveLength(1);
  });
});

describe('FinancePage budget lifecycle', () => {
  const cases = [
    ['ADMIN', 'pending_department_head', 'Waiting for Department Head approval', null],
    ['ADMIN', 'pending_sao', 'Waiting for SAO approval', null],
    ['ADMIN', 'approved', 'Approved: record spending against it', 'Open ledger'],
    ['ADMIN', 'rejected', 'Returned: edit and resubmit', 'Edit and resubmit'],
    ['DEPARTMENT_HEAD', 'pending_department_head', 'Review this budget', 'Open approvals'],
    ['DEPARTMENT_HEAD', 'pending_sao', 'Waiting for SAO approval', null],
    ['DEPARTMENT_HEAD', 'approved', 'Approved: the Admin records spending', null],
    ['SBO_OFFICER', 'pending_department_head', 'Waiting for Department Head approval', null],
    ['SBO_OFFICER', 'approved', 'Approved: the Admin records spending', null],
    ['SBO_OFFICER', 'rejected', 'Returned to the Admin for changes', null],
  ];

  it.each(cases)('%s sees a %s budget with "%s" and %s', async (role, status, title, buttonLabel) => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ submission_status: status })] });
    renderPage(role, `${BUDGETS}?record=5`, { initialTab: 'budgets' });

    const drawer = await screen.findByRole('dialog', { name: 'Sports Fest Budget' });
    expect(within(drawer).getByRole('list', { name: 'Budget progress' })).toBeInTheDocument();
    expect(within(drawer).getAllByText(title).length).toBeGreaterThan(0);
    const actions = within(drawer).queryAllByRole('button', { name: /^(?!Close panel)/ }).concat(within(drawer).queryAllByRole('link'));
    if (buttonLabel) {
      expect(actions.map((node) => node.textContent)).toEqual([buttonLabel]);
    } else {
      expect(actions).toHaveLength(0);
    }
  });

  it('shows the compact stepper on each budget row, with the step in words', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget(), budget({ id: 6, title: 'Foundation day budget', submission_status: 'approved' })] });
    renderPage('ADMIN', BUDGETS, { initialTab: 'budgets' });

    const waiting = await screen.findByRole('progressbar', { name: 'Budget progress for Sports Fest Budget' });
    expect(waiting).toHaveAttribute('aria-valuetext', 'Step 1 of 4: Proposed');
    expect(screen.getByRole('progressbar', { name: 'Budget progress for Foundation Day Budget' })).toHaveAttribute('aria-valuetext', 'Step 3 of 4: Spending');
  });

  it('opens the detail from a row, puts the budget in ?record= and closes it again', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget()] });
    renderPage('ADMIN', BUDGETS, { initialTab: 'budgets' });

    fireEvent.click(await screen.findByRole('button', { name: 'View details for Sports Fest Budget' }));
    expect(await screen.findByRole('dialog', { name: 'Sports Fest Budget' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`${BUDGETS}?record=5`);

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).not.toHaveTextContent('record=');
  });

  it('says so when ?record= names a budget that is not there', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [budget()] });
    renderPage('ADMIN', `${BUDGETS}?record=999`, { initialTab: 'budgets' });

    expect(await screen.findByText(/That budget was not found/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('edits and resubmits a returned budget from its detail', async () => {
    financeMocks.updateBudget.mockResolvedValue({ data: { id: 5 } });
    financeMocks.getBudgets.mockResolvedValue({ data: [budget({ submission_status: 'rejected', approval_remarks: 'Lower the amount.' })] });
    renderPage('ADMIN', `${BUDGETS}?record=5`, { initialTab: 'budgets' });

    const drawer = await screen.findByRole('dialog', { name: 'Sports Fest Budget' });
    expect(within(drawer).getByText('Lower the amount.')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit and resubmit' }));

    expect(await screen.findByRole('heading', { name: 'Edit budget' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sports fest budget')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('5000'), { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit for Approval' }));

    await waitFor(() => expect(financeMocks.updateBudget).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Sports fest budget', allocated_amount: 3500 })));
    expect(financeMocks.createBudget).not.toHaveBeenCalled();
  });
});

describe('FinancePage ?event= handoff', () => {
  it('opens the budget form with the event from the event page already chosen', async () => {
    renderPage('ADMIN', `${BUDGETS}?event=3`, { initialTab: 'budgets' });

    expect(await screen.findByRole('heading', { name: 'Propose budget' })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Sports Fest')).toBeInTheDocument();
  });

  it('submits the budget with that event and drops the parameter when the form closes', async () => {
    financeMocks.createBudget.mockResolvedValue({ data: { id: 9 } });
    renderPage('ADMIN', `${BUDGETS}?event=3`, { initialTab: 'budgets' });

    await screen.findByDisplayValue('Sports Fest');
    fireEvent.change(screen.getByPlaceholderText('e.g. Sports Fest 2026 Budget'), { target: { value: 'Sports Fest budget' } });
    const [amount, threshold] = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(amount, { target: { value: '1500' } });
    fireEvent.change(threshold, { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));

    await waitFor(() => expect(financeMocks.createBudget).toHaveBeenCalledWith(expect.objectContaining({ event_id: '3', allocated_amount: 1500 })));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('event='));
    expect(screen.queryByRole('heading', { name: 'Propose budget' })).not.toBeInTheDocument();
  });

  it('does not reopen the form after it is cancelled', async () => {
    renderPage('ADMIN', `${BUDGETS}?event=3`, { initialTab: 'budgets' });

    await screen.findByRole('heading', { name: 'Propose budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Propose budget' })).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).not.toHaveTextContent('event=');
  });

  it('leaves the form closed for a role that cannot propose budgets', async () => {
    renderPage('DEPARTMENT_HEAD', `${BUDGETS}?event=3`, { initialTab: 'budgets' });

    await waitFor(() => expect(financeMocks.getBudgets).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Propose budget' })).not.toBeInTheDocument();
  });

  it('preselects the event report type and the event in the report builder', async () => {
    renderPage('ADMIN', `${REPORTS}?event=3`, { initialTab: 'reports' });

    expect(await screen.findByRole('combobox', { name: 'Covered period' })).toHaveValue('event');
    expect(await screen.findByDisplayValue('Sports Fest')).toBeInTheDocument();
  });

  it('leaves the report builder on its default period without the parameter', async () => {
    renderPage('ADMIN', REPORTS, { initialTab: 'reports' });

    expect(await screen.findByRole('combobox', { name: 'Covered period' })).toHaveValue('semester');
  });
});

describe('FinancePage financial report lifecycle', () => {
  const cases = [
    ['ADMIN', 'draft', 'Review and submit', 'Submit for review'],
    ['ADMIN', 'pending_department_head', 'Waiting for Department Head approval', null],
    ['ADMIN', 'pending_sao', 'Waiting for SAO approval', null],
    ['ADMIN', 'approved', 'Approved', null],
    ['ADMIN', 'rejected', 'Returned: fix and resubmit', 'Resubmit for review'],
    ['DEPARTMENT_HEAD', 'draft', 'Waiting for the Admin to submit the report', null],
    ['DEPARTMENT_HEAD', 'pending_department_head', 'Review this report', 'Open approvals'],
    ['DEPARTMENT_HEAD', 'pending_sao', 'Waiting for SAO approval', null],
    ['DEPARTMENT_HEAD', 'rejected', 'Returned to the Admin for changes', null],
    ['SBO_OFFICER', 'draft', 'Waiting for the Admin to submit the report', null],
    ['SBO_OFFICER', 'pending_department_head', 'Waiting for Department Head approval', null],
    ['SBO_OFFICER', 'approved', 'Approved', null],
  ];

  it.each(cases)('%s sees a %s report with "%s" and %s', async (role, status, title, buttonLabel) => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [report({ submission_status: status })] });
    renderPage(role, `${REPORTS}?record=61`, { initialTab: 'reports' });

    const drawer = await screen.findByRole('dialog', { name: 'August Report' });
    expect(within(drawer).getByRole('list', { name: 'Financial report progress' })).toBeInTheDocument();
    expect(within(drawer).getAllByText(title).length).toBeGreaterThan(0);
    const actions = within(drawer).queryAllByRole('button', { name: /^(?!Close panel)/ }).concat(within(drawer).queryAllByRole('link'));
    expect(actions.map((node) => node.textContent)).toEqual(buttonLabel ? [buttonLabel] : []);
  });

  it('shows the compact stepper on each saved report row', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [report({ submission_status: 'pending_department_head' }), report({ id: 62, title: 'October report', submission_status: undefined })] });
    renderPage('ADMIN', REPORTS, { initialTab: 'reports' });

    expect(await screen.findByRole('progressbar', { name: 'Report progress for August Report' })).toHaveAttribute('aria-valuetext', 'Step 2 of 4: Department Head');
    expect(screen.getByRole('progressbar', { name: 'Report progress for October Report' })).toHaveAttribute('aria-valuetext', 'Step 1 of 4: Draft');
  });

  it('submits a draft with its supporting files from the detail', async () => {
    financeMocks.submitFinancialReport.mockResolvedValue({ data: report({ submission_status: 'pending_department_head' }) });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [report()] });
    renderPage('ADMIN', `${REPORTS}?record=61`, { initialTab: 'reports' });

    const drawer = await screen.findByRole('dialog', { name: 'August Report' });
    const file = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.change(within(drawer).getByLabelText('Supporting documents for August Report'), { target: { files: [file] } });
    expect(within(drawer).getByText(/1 file\(s\) attached/)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => expect(financeMocks.submitFinancialReport).toHaveBeenCalledWith(61, [file]));
    expect(await within(drawer).findByText('Waiting for Department Head approval')).toBeInTheDocument();
  });

  it('opens a report detail from its row', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [report()] });
    renderPage('ADMIN', REPORTS, { initialTab: 'reports' });

    fireEvent.click(await screen.findByRole('button', { name: 'View details for August Report' }));
    expect(await screen.findByRole('dialog', { name: 'August Report' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`${REPORTS}?record=61`);
  });
});

describe('FinancePage empty states', () => {
  it('names the Propose budget button and says why a budget matters on the first-run budget list', async () => {
    renderPage('ADMIN', BUDGETS, { initialTab: 'budgets' });

    expect(await screen.findByText('No budgets yet')).toBeInTheDocument();
    expect(screen.getByText(/Choose Propose budget above/)).toBeInTheDocument();
    expect(screen.getByText(/how much an event or activity may spend/)).toBeInTheDocument();
    expect(screen.queryByText('No budgets proposed yet.')).not.toBeInTheDocument();
  });

  it('tells a role that cannot propose budgets who can', async () => {
    renderPage('DEPARTMENT_HEAD', BUDGETS, { initialTab: 'budgets' });

    expect(await screen.findByText('No budgets to show yet')).toBeInTheDocument();
    expect(screen.getByText(/Only the organization Admin proposes budgets/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose budget' })).not.toBeInTheDocument();
  });

  it('says what posts to the ledger and how on the first-run ledger', async () => {
    renderPage('ADMIN', '/dashboard/finance/financial-ledger', { initialTab: 'transactions' });

    expect(await screen.findByText('No transactions recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/Verified collections, cash advances, paid student charges and merchandise orders post here by themselves/)).toBeInTheDocument();
    expect(screen.getByText(/Choose Record transaction above/)).toBeInTheDocument();
  });

  it('names who records transactions for a view-only role', async () => {
    renderPage('SBO_OFFICER', '/dashboard/finance/financial-ledger', { initialTab: 'transactions' });

    expect(await screen.findByText('No transactions to show yet')).toBeInTheDocument();
    expect(screen.getByText(/Only the organization Admin records transactions/)).toBeInTheDocument();
  });

  it('offers Clear filters when a filter hides every saved report', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: [report()] });
    renderPage('ADMIN', REPORTS, { initialTab: 'reports' });

    fireEvent.change(await screen.findByLabelText('Search report history'), { target: { value: 'nothing like this' } });
    expect(await screen.findByText('No saved reports match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('button', { name: 'View details for August Report' })).toBeInTheDocument();
  });

  it('explains the first-run report list and the restricted one', async () => {
    const { unmount } = renderPage('ADMIN', REPORTS, { initialTab: 'reports' });
    expect(await screen.findByText('No saved reports yet')).toBeInTheDocument();
    expect(screen.getByText(/saves here as a draft, then you submit it to the Department Head/)).toBeInTheDocument();
    unmount();

    renderPage('DEPARTMENT_HEAD', REPORTS, { initialTab: 'reports' });
    expect(await screen.findByText('No saved reports to show yet')).toBeInTheDocument();
    expect(screen.getByText(/Only the organization Admin prepares financial reports/)).toBeInTheDocument();
  });

  it('explains the first-run forecast', async () => {
    renderPage('ADMIN', '/dashboard/finance/financial-insights', { initialTab: 'forecasting' });

    expect(await screen.findByText('No forecasts yet')).toBeInTheDocument();
    expect(screen.getByText(/Choose Generate forecast above/)).toBeInTheDocument();
  });
});

describe('FinancePage audit tab', () => {
  it('no longer loads audit logs or renders an audit view', async () => {
    renderPage('ADMIN', '/dashboard/finance', { initialTab: 'audit' });

    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalled());
    expect(financeMocks.getAuditLogs).not.toHaveBeenCalled();
    expect(screen.queryByText('Admin Audit Logs')).not.toBeInTheDocument();
    expect(screen.queryByText('No audit activity recorded.')).not.toBeInTheDocument();
  });
});
