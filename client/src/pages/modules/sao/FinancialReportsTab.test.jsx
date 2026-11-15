import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialReportsTab from './FinancialReportsTab';

const financeMocks = vi.hoisted(() => ({
  downloadFinancialReportPdf: vi.fn(),
  getFinancialReport: vi.fn(),
  getFinancialReports: vi.fn(),
  getReportChecks: vi.fn(),
  explainReportChecks: vi.fn(),
  ignoreReportCheck: vi.fn(),
}));
const draftMocks = vi.hoisted(() => ({ recordAiOutcome: vi.fn() }));
const approvalMocks = vi.hoisted(() => ({
  getApprovalRequests: vi.fn(),
  reviewApprovalRequest: vi.fn(),
}));
const systemMocks = vi.hoisted(() => ({ getSystemOrganizations: vi.fn() }));
const aiMocks = vi.hoisted(() => ({ draftReviewNote: vi.fn(), recordDraftOutcome: vi.fn() }));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock('../../../services/financeService', () => financeMocks);
vi.mock('../../../services/approvalService', () => approvalMocks);
vi.mock('../../../services/aiDraftService', () => draftMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);
vi.mock('../../../services/aiDraftService', () => aiMocks);
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
    financeMocks.getReportChecks.mockResolvedValue({ data: { findings: [{ key: 'missing_receipt:11', code: 'missing_receipt', severity: 'medium', message: 'The expense of PHP 90.00 for Supplies on Sep 2, 2026 has no receipt reference.', ignored: null }] } });
    draftMocks.recordAiOutcome.mockResolvedValue({});
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

  it('shows the reviewer the same checks, without a way to ignore them', async () => {
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');

    await viewReportFromMenu();

    expect(await screen.findByText(/has no receipt reference/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Checks on this report' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ignore with a reason' })).not.toBeInTheDocument();
    expect(financeMocks.getReportChecks).toHaveBeenCalledWith(8);
  });

  it('records the explanation as used once the reviewer decides', async () => {
    financeMocks.explainReportChecks.mockResolvedValue({ data: { engine: 'claude', ai_output_id: 61, text: 'summary', summary: 'There is 1 thing to check.', items: [{ key: 'missing_receipt:11', sentence: 'Add the receipt reference.' }] } });
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');
    await viewReportFromMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Explain and put in order' }));
    await screen.findByText('There is 1 thing to check.');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve report' }));

    await waitFor(() => expect(draftMocks.recordAiOutcome).toHaveBeenCalledWith(61, 'summary'));
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

  it('puts Download PDF in the row next to Review, a read that costs no extra step, and leaves Approve and Return to the drawer', async () => {
    financeMocks.downloadFinancialReportPdf.mockResolvedValue({ headers: {}, data: new Blob(['pdf']) });
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    render(<FinancialReportsTab />);

    const inbox = await screen.findByRole('region', { name: 'Report inbox' });
    const row = within(inbox).getByRole('listitem');
    expect(within(row).getByRole('button', { name: 'Review September Income Statement' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Download PDF of September Income Statement' }));
    await waitFor(() => expect(financeMocks.downloadFinancialReportPdf).toHaveBeenCalledWith(8));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));

    const confirm = await screen.findByRole('button', { name: 'Return report' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for returning'), { target: { value: 'Totals do not match the ledger' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'rejected', remarks: 'Totals do not match the ledger' }));
  });

  it('drafts the reason for returning a report, keeps Return off until there is a reason, and reports the final text', async () => {
    aiMocks.draftReviewNote.mockResolvedValue({ data: { text: 'The totals do not match the ledger.', engine: 'template', ai_output_id: 60 } });
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');
    await viewReportFromMenu();
    await screen.findByText('Income and expenses were calculated from the saved ledger.');
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(await screen.findByRole('button', { name: 'Return report' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));

    await waitFor(() => expect(screen.getByLabelText('Reason for returning')).toHaveValue('The totals do not match the ledger.'));
    expect(aiMocks.draftReviewNote).toHaveBeenCalledWith({ flow: 'financial_report', record_id: 8, decision: 'returned', marks: [], reviewer_notes: '' });
    expect(screen.getByText('Built-in rules')).toBeInTheDocument();
    expect(screen.getByText('Draft. Read and edit before you send.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reason for returning'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Return report' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for returning'), { target: { value: 'The totals do not match.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return report' }));

    await waitFor(() => expect(approvalMocks.reviewApprovalRequest).toHaveBeenCalledWith(31, { status: 'rejected', remarks: 'The totals do not match.' }));
    await waitFor(() => expect(aiMocks.recordDraftOutcome).toHaveBeenCalledWith(60, 'The totals do not match.'));
  });

  it('asks before it rewords a reason already typed for a report', async () => {
    aiMocks.draftReviewNote.mockResolvedValue({ data: { text: 'Reworded reason.', engine: 'claude', ai_output_id: 61 } });
    render(<FinancialReportsTab />);
    await screen.findByText('September Income Statement');
    await viewReportFromMenu();
    await screen.findByText('Income and expenses were calculated from the saved ledger.');
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    fireEvent.change(await screen.findByLabelText('Reason for returning'), { target: { value: 'totals wrong' } });

    fireEvent.click(screen.getByRole('button', { name: 'Improve my wording' }));
    expect(screen.getByLabelText('Reason for returning')).toHaveValue('totals wrong');
    expect(aiMocks.draftReviewNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace my text' }));

    await waitFor(() => expect(screen.getByLabelText('Reason for returning')).toHaveValue('Reworded reason.'));
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
