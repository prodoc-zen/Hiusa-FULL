import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 20 },
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
});

describe('FinancePage forecast explainability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    financeMocks.getTransactions.mockResolvedValue({
      data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 20 },
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
