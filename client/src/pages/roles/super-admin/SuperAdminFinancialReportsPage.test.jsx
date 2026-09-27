import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdminFinancialReportsPage from './SuperAdminFinancialReportsPage';

const financeMocks = vi.hoisted(() => ({
  downloadFinancialReportPdf: vi.fn(),
  getFinancialReport: vi.fn(),
  getFinancialReports: vi.fn(),
}));
const approvalMocks = vi.hoisted(() => ({
  getApprovalRequests: vi.fn(),
  reviewApprovalRequest: vi.fn(),
}));
const systemMocks = vi.hoisted(() => ({ getSystemOrganizations: vi.fn() }));

vi.mock('../../../services/financeService', () => financeMocks);
vi.mock('../../../services/approvalService', () => approvalMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);

const report = {
  id: 8,
  title: 'September Income Statement',
  document_type: 'income_statement',
  organization: { id: 7, acronym: 'CCS', name: 'Computing Society' },
  submission_status: 'pending_sao',
  submitted_at: '2026-09-10T08:00:00Z',
  summary_text: 'Income and expenses were calculated from the saved ledger.',
  signatories: { treasurer: 'Taylor Treasurer' },
  supporting_documents: [],
};

describe('SuperAdminFinancialReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemMocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 7, acronym: 'CCS', name: 'Computing Society' }] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [report], current_page: 1, per_page: 20, total: 1 } });
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report, transactions: [] } });
    approvalMocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 31, entity_id: 8, entity_type: 'financial_report' }] } });
    approvalMocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
  });

  it('loads only the received report inbox and applies report filters', async () => {
    render(<SuperAdminFinancialReportsPage />);

    expect(await screen.findByText('September Income Statement')).toBeInTheDocument();
    expect(screen.queryByText('Transaction history')).not.toBeInTheDocument();
    expect(screen.queryByText('Submission deadline')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'income_statement' } });

    await waitFor(() => expect(financeMocks.getFinancialReports).toHaveBeenLastCalledWith(expect.objectContaining({
      document_type: 'income_statement',
      per_page: 20,
    })));
    expect(approvalMocks.getApprovalRequests).toHaveBeenCalledWith({ status: 'pending', entity_type: 'financial_report', per_page: 100 });
  });

  it('reviews a received report without exposing other financial operations', async () => {
    render(<SuperAdminFinancialReportsPage />);
    await screen.findByText('September Income Statement');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Income and expenses were calculated from the saved ledger.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve report' }));

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'approved' }));
  });
});
