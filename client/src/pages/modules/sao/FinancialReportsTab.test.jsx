import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialReportsTab from './FinancialReportsTab';

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
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));

vi.mock('../../../services/financeService', () => financeMocks);
vi.mock('../../../services/approvalService', () => approvalMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);
vi.mock('../../../utils/openProtectedFile', () => openMocks);

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

describe('FinancialReportsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemMocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 7, acronym: 'CCS', name: 'Computing Society' }] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [report], current_page: 1, per_page: 20, total: 1 } });
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report, transactions: [] } });
    approvalMocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 31, entity_id: 8, entity_type: 'financial_report' }] } });
    approvalMocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
  });

  it('loads only the received report inbox and applies report filters', async () => {
    render(<FinancialReportsTab />);

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
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Income and expenses were calculated from the saved ledger.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve report' }));

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'approved' }));
  });

  it('returns a report to the organization only with a reason', async () => {
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText('Income and expenses were calculated from the saved ledger.');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    const confirm = await screen.findByRole('button', { name: 'Reject report' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Totals do not match the ledger' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'rejected', remarks: 'Totals do not match the ledger' }));
  });

  it('opens supporting documents through the authenticated open_url', async () => {
    const withDocument = { ...report, supporting_documents: [{ index: 0, name: 'Receipts.pdf', mime_type: 'application/pdf', size: 1200, open_url: '/financial-reports/8/documents/0' }] };
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report: withDocument, transactions: [] } });
    openMocks.openProtectedFile.mockResolvedValue();
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Receipts.pdf' }));

    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/financial-reports/8/documents/0'));
  });

  it('shows why a supporting document could not be opened', async () => {
    const withDocument = { ...report, supporting_documents: [{ index: 0, name: 'Receipts.pdf', open_url: '/financial-reports/8/documents/0' }] };
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report: withDocument, transactions: [] } });
    openMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Receipts.pdf' }));

    expect(await screen.findByText('Allow pop-ups to open this file.')).toBeInTheDocument();
  });

  it('shows the empty inbox message', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [], current_page: 1, per_page: 20, total: 0 } });
    render(<FinancialReportsTab />);
    expect(await screen.findByText('No received reports found.')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    financeMocks.getFinancialReports.mockRejectedValueOnce(new Error('offline'));
    render(<FinancialReportsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load received financial reports.');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('September Income Statement')).toBeInTheDocument();
  });
});
