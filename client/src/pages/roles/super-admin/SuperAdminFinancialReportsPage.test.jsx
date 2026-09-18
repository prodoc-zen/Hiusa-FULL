import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdminFinancialReportsPage from './SuperAdminFinancialReportsPage';

const financeMocks = vi.hoisted(() => ({
  getFinancialReport: vi.fn(),
  getFinancialReportDeadline: vi.fn(),
  getFinancialReports: vi.fn(),
  getTransactionSummary: vi.fn(),
  getTransactions: vi.fn(),
  setFinancialReportDeadline: vi.fn(),
}));
const systemMocks = vi.hoisted(() => ({ getSystemOrganizations: vi.fn() }));

vi.mock('../../../services/financeService', () => financeMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);

describe('SuperAdminFinancialReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemMocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 7, acronym: 'CCS', name: 'Computing Society' }] });
    financeMocks.getTransactions.mockResolvedValue({
      data: {
        data: [{ id: 1, organization: { acronym: 'CCS' }, description: 'Membership collection', type: 'income', amount: 1500, transaction_date: '2026-09-01T08:00:00Z', event: { title: 'Orientation' } }],
        current_page: 1, per_page: 10, total: 1,
      },
    });
    financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 1500, total_expense: 0, net_balance: 1500 } });
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [{ id: 8, title: 'September Report', organization: { acronym: 'CCS' }, submission_status: 'pending_sao', generated_at: '2026-09-10T08:00:00Z' }] } });
    financeMocks.getFinancialReportDeadline.mockResolvedValue({ data: null });
    financeMocks.setFinancialReportDeadline.mockResolvedValue({ data: { id: 2, deadline_at: '2026-10-01T09:00:00Z' } });
  });

  it('loads cross-organization records and sends event filters to both transaction endpoints', async () => {
    render(<SuperAdminFinancialReportsPage />);

    expect(await screen.findByText('Membership collection')).toBeInTheDocument();
    expect(screen.getByText('September Report')).toBeInTheDocument();
    expect(screen.getByText('Orientation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.change(screen.getByLabelText('Event filter'), { target: { value: 'Orientation' } });

    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ event_search: 'Orientation' })));
    expect(financeMocks.getTransactionSummary).toHaveBeenLastCalledWith(expect.objectContaining({ event_search: 'Orientation' }));
  });

  it('sets the deadline through the SAO form', async () => {
    render(<SuperAdminFinancialReportsPage />);
    await screen.findByText('Membership collection');

    fireEvent.change(screen.getByLabelText('New deadline'), { target: { value: '2026-10-01T17:00' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Attach signed receipts.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set deadline' }));

    await waitFor(() => expect(financeMocks.setFinancialReportDeadline).toHaveBeenCalledWith({
      deadline_at: '2026-10-01T17:00',
      instructions: 'Attach signed receipts.',
    }));
    expect(await screen.findByText(/official announcement and Admin notifications/i)).toBeInTheDocument();
  });
});
