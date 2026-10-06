import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentHeadApprovalsPage from './DepartmentHeadApprovalsPage';

const mocks = vi.hoisted(() => ({ getApprovalRequests: vi.fn(), reviewApprovalRequest: vi.fn(), downloadFinancialReportPdf: vi.fn() }));
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
