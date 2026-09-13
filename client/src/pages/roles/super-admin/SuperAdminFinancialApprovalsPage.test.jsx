import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdminFinancialApprovalsPage from './SuperAdminFinancialApprovalsPage';

const approvalMocks = vi.hoisted(() => ({
  getApprovalRequests: vi.fn(),
  reviewApprovalRequest: vi.fn(),
}));
const financeMocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  getCashAdvances: vi.fn(),
  verifyCollection: vi.fn(),
  approveCashAdvance: vi.fn(),
}));

vi.mock('../../../services/approvalService', () => approvalMocks);
vi.mock('../../../services/financeService', () => financeMocks);

describe('SuperAdminFinancialApprovalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approvalMocks.getApprovalRequests.mockResolvedValue({
      data: {
        data: [{
          id: 10,
          title: 'Leadership summit budget',
          requested_at: '2026-09-13T08:00:00Z',
          requester: { first_name: 'Ada', last_name: 'Santos' },
          summary: { allocated_amount: 25000 },
        }],
        current_page: 1,
        last_page: 1,
        per_page: 100,
        total: 1,
      },
    });
    financeMocks.getCollections.mockResolvedValue({ data: [{ id: 20, source: 'Membership fees', reference: 'COL-20', amount_collected: 5000, status: 'pending', collected_at: '2026-09-13T09:00:00Z' }] });
    financeMocks.getCashAdvances.mockResolvedValue({ data: [{ id: 30, purpose: 'Venue deposit', reference: 'ADV-30', amount: 8000, status: 'pending', created_at: '2026-09-13T10:00:00Z' }] });
    approvalMocks.reviewApprovalRequest.mockResolvedValue({});
    financeMocks.verifyCollection.mockResolvedValue({});
    financeMocks.approveCashAdvance.mockResolvedValue({});
  });

  it('shows all final financial queues and requires a budget rejection reason', async () => {
    render(<SuperAdminFinancialApprovalsPage />);

    await screen.findByText('Leadership summit budget');
    expect(screen.getByText('Membership fees')).toBeInTheDocument();
    expect(screen.getByText('Venue deposit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const submit = screen.getByRole('button', { name: 'Reject budget' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Attach the supplier quotation.' } });
    fireEvent.click(submit);

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(10, {
      status: 'rejected',
      remarks: 'Attach the supplier quotation.',
    }));
  });

  it('confirms collection verification before posting it', async () => {
    render(<SuperAdminFinancialApprovalsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify collection' }));

    await waitFor(() => expect(financeMocks.verifyCollection).toHaveBeenCalledWith(20));
  });
});
