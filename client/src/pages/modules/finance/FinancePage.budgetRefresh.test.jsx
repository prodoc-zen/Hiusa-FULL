import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  getFinancialReports: vi.fn(),
}));

vi.mock('../../../services/financeService', () => ({
  ...financeMocks,
  updateBudget: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  deleteBudget: vi.fn(),
  generateForecast: vi.fn(),
  generateBudgetAdvice: vi.fn(),
  getFinancialReport: vi.fn(),
  generateFinancialReport: vi.fn(),
  downloadFinancialReportPdf: vi.fn(),
  submitFinancialReport: vi.fn(),
}));

vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: vi.fn(() => Promise.resolve({ data: [] })) }));

const eventMocks = vi.hoisted(() => ({ getEvents: vi.fn() }));
vi.mock('../../../services/eventService', () => eventMocks);

const saved = {
  id: 4, title: 'Walk budget', allocated_amount: 3000, remaining_amount: 3000, warning_threshold: 2400,
  approval_status: 'pending', submission_status: 'pending_department_head', event_id: null, financial_semester_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  financeMocks.getTransactions.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } });
  financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 0, total_expense: 0, net_balance: 0 } });
  financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
  financeMocks.getInvoices.mockResolvedValue({ data: [] });
  eventMocks.getEvents.mockResolvedValue({ data: [] });
});

describe('Budgets list after a proposal is saved', () => {
  it('shows the new budget without waiting for the forecasts and reports to reload', async () => {
    financeMocks.getBudgets.mockResolvedValueOnce({ data: [] }).mockResolvedValue({ data: [saved] });
    financeMocks.getForecasts.mockResolvedValueOnce({ data: [] }).mockReturnValue(new Promise(() => {}));
    financeMocks.getFinancialReports.mockResolvedValueOnce({ data: [] }).mockReturnValue(new Promise(() => {}));
    financeMocks.createBudget.mockResolvedValue({ data: saved });

    render(
      <MemoryRouter initialEntries={['/dashboard/finance/budget-allocation']}>
        <FinancePage initialTab="budgets" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Propose budget' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Sports Fest 2026 Budget'), { target: { value: 'Walk budget' } });
    const [amount, threshold] = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(amount, { target: { value: '3000' } });
    fireEvent.change(threshold, { target: { value: '2400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(financeMocks.createBudget).toHaveBeenCalled());
    expect(await screen.findByText('Walk budget')).toBeInTheDocument();
  });
});

describe('Record transaction form', () => {
  it('starts on today so Save transaction needs only a description and an amount', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [] });
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });

    render(
      <MemoryRouter initialEntries={['/dashboard/finance/financial-ledger']}>
        <FinancePage initialTab="transactions" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Record transaction' }));
    const now = new Date();
    const pad = (part) => String(part).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(await screen.findByDisplayValue(today)).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save transaction' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g. Event supplies purchase'), { target: { value: 'Printing' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '250' } });
    expect(save).toBeEnabled();
  });
});
