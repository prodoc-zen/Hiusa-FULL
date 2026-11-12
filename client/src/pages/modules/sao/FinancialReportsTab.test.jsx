import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock('../../../services/financeService', () => financeMocks);
vi.mock('../../../services/approvalService', () => approvalMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);
vi.mock('../../../utils/openProtectedFile', () => openMocks);
vi.mock('../../../lib/notify', () => ({ default: toasts }));

const report = {
  id: 8,
  title: 'September Income Statement',
  document_type: 'income_statement',
  organization: { id: 7, acronym: 'CCS', name: 'Computing Society' },
  submission_status: 'pending_sao',
  submitted_at: '2026-09-10T08:00:00Z',
  summary_text: 'Income and expenses were calculated from the saved ledger.',
  signatories: { treasurer: 'Taylor Treasurer', sbo_adviser: 'SBO Adviser' },
  supporting_documents: [],
};

async function viewReportFromMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Review September Income Statement' }));
}

describe('FinancialReportsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemMocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 7, acronym: 'CCS', name: 'Computing Society' }] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [report], current_page: 1, per_page: 20, total: 1 } });
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report, transactions: [] } });
    approvalMocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 31, entity_id: 8, entity_type: 'financial_report' }] } });
    approvalMocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
  });

  it('states what the tab is for and never calls the reports received', async () => {
    render(<FinancialReportsTab />);

    expect(await screen.findByText('Reports organizations submitted for SAO review. Decide each one here.')).toBeInTheDocument();
    expect(screen.queryByText(/received/i)).not.toBeInTheDocument();
  });

  it('opens on the reports awaiting review when the organization has some waiting', async () => {
    render(<FinancialReportsTab initialOrganizationId="7" initialStatus="pending_sao" />);

    await screen.findByText('September Income Statement');
    expect(financeMocks.getFinancialReports).toHaveBeenLastCalledWith(expect.objectContaining({ organization_id: '7', status: 'pending_sao' }));
  });

  it('loads only the financial reports inbox and applies report filters', async () => {
    render(<FinancialReportsTab />);

    expect(await screen.findByText('September Income Statement')).toBeInTheDocument();
    expect(screen.queryByText('Transaction history')).not.toBeInTheDocument();
    expect(screen.queryByText('Submission deadline')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'income_statement' } });

    await waitFor(() => expect(financeMocks.getFinancialReports).toHaveBeenLastCalledWith(expect.objectContaining({
      document_type: 'income_statement',
      per_page: 20,
    })));
    expect(approvalMocks.getApprovalRequests).toHaveBeenCalledWith({ status: 'pending', entity_type: 'financial_report', per_page: 100 });
  });

  it('reviews a financial report without exposing other financial operations', async () => {
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    await viewReportFromMenu();
    expect(await screen.findByText('Income and expenses were calculated from the saved ledger.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve report' }));

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'approved' }));
  });

  it('labels each signatory role the way the report form does and shows the name as typed', async () => {
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    await viewReportFromMenu();
    expect(await screen.findByText('SBO Adviser:')).toBeInTheDocument();
    expect(screen.getByText('Treasurer:')).toBeInTheDocument();
    expect(screen.getByText('SBO Adviser', { selector: 'span' })).toBeInTheDocument();
  });

  it('lists each report as one aligned Report, Status, Details, Action row', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [report, { ...report, id: 9, title: 'October Financial Report', document_type: 'financial_report', submission_status: 'approved' }], current_page: 1, per_page: 20, total: 2 } });
    render(<FinancialReportsTab />);

    const inbox = await screen.findByRole('region', { name: 'Report inbox' });
    ['Report', 'Status', 'Details', 'Action'].forEach((name) => expect(within(inbox).getByText(name)).toBeInTheDocument());
    const rows = within(inbox).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(row.firstElementChild.children).toHaveLength(4));
    expect(within(rows[0]).getByText('Awaiting SAO review')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Income Statement/, { selector: 'p:not(.font-semibold)' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('Approved')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'View October Financial Report' })).toBeInTheDocument();
    expect(within(inbox).queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('offers Download PDF and the pending decisions in the report drawer', async () => {
    render(<FinancialReportsTab />);
    await viewReportFromMenu();
    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve report' }));
    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'approved' }));
  });

  it('returns a report to the organization only with a reason', async () => {
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    await viewReportFromMenu();
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

    await viewReportFromMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Receipts.pdf' }));

    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/financial-reports/8/documents/0'));
  });

  it('shows why a supporting document could not be opened', async () => {
    const withDocument = { ...report, supporting_documents: [{ index: 0, name: 'Receipts.pdf', open_url: '/financial-reports/8/documents/0' }] };
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report: withDocument, transactions: [] } });
    openMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    await viewReportFromMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Receipts.pdf' }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Allow pop-ups to open this file.'));
  });

  it('cuts a long supporting document name with an ellipsis and keeps it whole in the title', async () => {
    const longName = 'official-receipts-and-liquidation-statement-for-the-foundation-day-2026.pdf';
    const withDocument = { ...report, supporting_documents: [{ index: 0, name: longName, open_url: '/financial-reports/8/documents/0' }] };
    financeMocks.getFinancialReport.mockResolvedValue({ data: { report: withDocument, transactions: [] } });
    render(<FinancialReportsTab />);

    await viewReportFromMenu();
    const link = await screen.findByRole('button', { name: longName });
    expect(link).toHaveAttribute('title', longName);
    expect(within(link).getByText(longName)).toHaveClass('truncate');
  });

  it('shows the empty inbox message', async () => {
    financeMocks.getFinancialReports.mockResolvedValue({ data: { data: [], current_page: 1, per_page: 20, total: 0 } });
    render(<FinancialReportsTab />);
    expect(await screen.findByText('No financial reports found.')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    financeMocks.getFinancialReports.mockRejectedValueOnce(new Error('offline'));
    render(<FinancialReportsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load financial reports.');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('September Income Statement')).toBeInTheDocument();
  });
});
