import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentHeadApprovalsPage from './DepartmentHeadApprovalsPage';

const mocks = vi.hoisted(() => ({ getApprovalRequests: vi.fn(), reviewApprovalRequest: vi.fn(), downloadFinancialReportPdf: vi.fn(), getCollegeOrganizations: vi.fn(), openProtectedFile: vi.fn() }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: mocks.getCollegeOrganizations }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));
vi.mock('../../../services/approvalService', () => ({ getApprovalRequests: mocks.getApprovalRequests, reviewApprovalRequest: mocks.reviewApprovalRequest }));
vi.mock('../../../services/financeService', () => ({ downloadFinancialReportPdf: mocks.downloadFinancialReportPdf }));

const reportRequest = (summary) => ({
  id: 5, entity_type: 'financial_report', entity_id: 9, title: 'October Financial Report', status: 'pending',
  requested_at: '2026-10-06T10:00:00+08:00', requester: { first_name: 'Pat', last_name: 'President', school_id: 2026001 },
  summary: { organization: { acronym: 'CSS' }, period_start: '2026-10-01', period_end: '2026-10-31', total_income: 1000, total_expense: 325, net_balance: 675, ...summary },
});

const respondWith = (request) => mocks.getApprovalRequests.mockResolvedValue({ data: { data: [request], current_page: 1, last_page: 1, per_page: 20, total: 1 } });

describe('DepartmentHeadApprovalsPage financial report card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the saved income and expense and names the cash advances beside them', async () => {
    respondWith(reportRequest({ cash_advances_released: 500, cash_advance_repayments: 200 }));
    render(<DepartmentHeadApprovalsPage />);

    expect(await screen.findByText(/Inflows ₱1,000\.00 \| Outflows ₱325\.00 \| Cash advances released ₱500\.00 \| Cash advance repayments ₱200\.00/)).toBeInTheDocument();
  });

  it('leaves the cash advance figures out when the report has none', async () => {
    respondWith(reportRequest({ cash_advances_released: 0, cash_advance_repayments: 0 }));
    render(<DepartmentHeadApprovalsPage />);

    expect(await screen.findByText(/Inflows ₱1,000\.00 \| Outflows ₱325\.00$/)).toBeInTheDocument();
    expect(screen.queryByText(/Cash advance/)).not.toBeInTheDocument();
  });
});

describe('DepartmentHeadApprovalsPage college scope', () => {
  const organizations = [{ id: 7, name: 'Chess Club' }, { id: 8, name: 'Drama Guild' }];
  const row = (id, organization_id, title) => ({ ...reportRequest({}), id, organization_id, title });
  const withDocuments = (item, documents) => ({ ...item, summary: { ...item.summary, supporting_documents: documents } });
  const page = (data) => ({ data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: organizations, current_page: 1, last_page: 1, per_page: 100, total: 2 } });
  });

  afterEach(() => localStorage.clear());

  it('names the organization of each request and filters by organization', async () => {
    mocks.getApprovalRequests.mockResolvedValue(page([row(1, 7, 'Chess report'), row(2, 8, 'Drama report')]));
    render(<DepartmentHeadApprovalsPage />);

    expect(await screen.findByText(/chess report/i)).toBeInTheDocument();
    expect(await screen.findAllByText('Chess Club')).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '8' } });

    await waitFor(() => expect(screen.queryByText(/chess report/i)).not.toBeInTheDocument());
    expect(screen.getByText(/drama report/i)).toBeInTheDocument();
    expect(screen.getByText(/1 matching request ·/)).toBeInTheDocument();
  });

  it('opens a supporting document through the authenticated helper', async () => {
    mocks.getApprovalRequests.mockResolvedValue(page([withDocuments(row(1, 7, 'Chess report'), [{ index: 0, name: 'receipts.pdf', mime_type: 'application/pdf', size: 10, open_url: '/financial-reports/9/documents/0' }])]));
    mocks.openProtectedFile.mockResolvedValue();
    render(<DepartmentHeadApprovalsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Details/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'receipts.pdf' }));

    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/financial-reports/9/documents/0');
  });

  it('shows why a document could not be opened', async () => {
    mocks.getApprovalRequests.mockResolvedValue(page([withDocuments(row(1, 7, 'Chess report'), [{ index: 0, name: 'receipts.pdf', open_url: '/x' }])]));
    mocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    render(<DepartmentHeadApprovalsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Details/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'receipts.pdf' }));

    expect(await screen.findByText('Allow pop-ups to open this file.')).toBeInTheDocument();
  });

  it('does not call the college endpoint or show the filter for other roles', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    respondWith(reportRequest({}));
    render(<DepartmentHeadApprovalsPage />);

    await screen.findByText('October Financial Report');
    expect(mocks.getCollegeOrganizations).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Organization')).not.toBeInTheDocument();
  });
});
