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
  getFinancialReports: vi.fn(),
}));

vi.mock('../../../services/financeService', () => ({
  ...financeMocks,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  generateForecast: vi.fn(),
  createBudget: vi.fn(),
  generateBudgetAdvice: vi.fn(),
  generateFinancialReport: vi.fn(),
}));

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
  });

  it('clears the search term and reloads the unfiltered ledger', async () => {
    render(<FinancePage initialTab="transactions" />);

    const search = await screen.findByPlaceholderText('Search transactions...');
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalledWith({ page: 1 }));

    fireEvent.change(search, { target: { value: 'rent' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith({ page: 1, search: 'rent' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(search).toHaveValue('');
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith({ page: 1 }));
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

    expect(await screen.findByText('Venue reservation')).toBeInTheDocument();
    expect(screen.getByText('Sep 8, 2026')).toBeInTheDocument();
    expect(screen.getByText('HIUSA-1-00000007')).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'HIUSA-1-00000009' })).toBeInTheDocument();
    expect(within(dialog).getByText('General Assembly')).toBeInTheDocument();
    expect(within(dialog).getByText('Operating Budget')).toBeInTheDocument();
    expect(within(dialog).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(dialog).getByText('Marco Santos')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open receipt file' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the budget proposal form when launched from the request selector', async () => {
    render(<FinancePage initialTab="budgets" startBudgetProposal />);

    expect(await screen.findByRole('heading', { name: 'Propose Budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeInTheDocument();
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

    expect((await screen.findAllByText(/at least two different calendar months/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
