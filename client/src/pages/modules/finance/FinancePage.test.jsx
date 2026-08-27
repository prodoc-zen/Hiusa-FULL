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
