import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { budgetLifecycle, electionLifecycle, eventLifecycle, financialReportLifecycle } from '../../../lib/lifecycle';
import DepartmentHeadApprovalsPage from './DepartmentHeadApprovalsPage';

const mocks = vi.hoisted(() => ({ getApprovalRequests: vi.fn(), reviewApprovalRequest: vi.fn(), downloadFinancialReportPdf: vi.fn(), getCollegeOrganizations: vi.fn(), openProtectedFile: vi.fn() }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: mocks.getCollegeOrganizations }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));
vi.mock('../../../services/approvalService', () => ({ getApprovalRequests: mocks.getApprovalRequests, reviewApprovalRequest: mocks.reviewApprovalRequest }));
vi.mock('../../../services/financeService', () => ({ downloadFinancialReportPdf: mocks.downloadFinancialReportPdf }));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname}{search}</p>;
}

function renderPage(entry = '/dashboard/approvals') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><DepartmentHeadApprovalsPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const reportRequest = (summary) => ({
  id: 5, entity_type: 'financial_report', entity_id: 9, title: 'October Financial Report', status: 'pending', required_role: 'DEPARTMENT_HEAD',
  requested_at: '2026-10-06T10:00:00+08:00', requester: { first_name: 'Pat', last_name: 'President', school_id: 2026001 },
  summary: { organization: { acronym: 'CSS' }, period_start: '2026-10-01', period_end: '2026-10-31', total_income: 1000, total_expense: 325, net_balance: 675, ...summary },
});

const page = (data, extra = {}) => ({ data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length, ...extra } });
const respondWith = (request) => mocks.getApprovalRequests.mockResolvedValue(page([request]));

describe('DepartmentHeadApprovalsPage financial report card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the saved income and expense and names the cash advances beside them', async () => {
    respondWith(reportRequest({ cash_advances_released: 500, cash_advance_repayments: 200 }));
    renderPage();

    expect(await screen.findByText(/Inflows ₱1,000\.00 \| Outflows ₱325\.00 \| Cash advances released ₱500\.00 \| Cash advance repayments ₱200\.00/)).toBeInTheDocument();
  });

  it('leaves the cash advance figures out when the report has none', async () => {
    respondWith(reportRequest({ cash_advances_released: 0, cash_advance_repayments: 0 }));
    renderPage();

    expect(await screen.findByText(/Inflows ₱1,000\.00 \| Outflows ₱325\.00$/)).toBeInTheDocument();
    expect(screen.queryByText(/Cash advance/)).not.toBeInTheDocument();
  });
});

describe('DepartmentHeadApprovalsPage college scope', () => {
  const organizations = [{ id: 7, name: 'Chess Club' }, { id: 8, name: 'Drama Guild' }];
  const row = (id, organization_id, title) => ({ ...reportRequest({}), id, organization_id, title });
  const withDocuments = (item, documents) => ({ ...item, summary: { ...item.summary, supporting_documents: documents } });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: organizations, current_page: 1, last_page: 1, per_page: 100, total: 2 } });
  });

  afterEach(() => localStorage.clear());

  it('names the organization of each request and has the server filter by organization', async () => {
    mocks.getApprovalRequests.mockImplementation(async (params) => page(params.organization_id === '8'
      ? [row(2, 8, 'Drama report')]
      : [row(1, 7, 'Chess report'), row(2, 8, 'Drama report')]));
    renderPage();

    expect(await screen.findByText(/chess report/i)).toBeInTheDocument();
    expect(await screen.findAllByText('Chess Club')).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '8' } });

    await waitFor(() => expect(screen.queryByText(/chess report/i)).not.toBeInTheDocument());
    expect(screen.getByText(/drama report/i)).toBeInTheDocument();
    expect(screen.getByText(/1 matching request ·/)).toBeInTheDocument();
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith(expect.objectContaining({ organization_id: '8', status: 'pending', page: 1 }));
  });

  it('takes the counts, the pending total and the paging from the server for one organization', async () => {
    mocks.getApprovalRequests.mockImplementation(async (params) => {
      if (params.per_page === 1) return { data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: params.organization_id === '8' ? 3 : 9 } };
      if (params.organization_id !== '8') return page([row(1, 7, 'Chess report')]);
      return { data: { data: [row(20 + params.page, 8, `Drama report ${params.page}`)], current_page: params.page, last_page: 3, per_page: 20, total: 45 } };
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Pending (9)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '8' } });

    expect(await screen.findByText(/drama report 1/i)).toBeInTheDocument();
    expect(screen.getByText('45 matching requests · 3 awaiting action')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pending (3)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page of requests' }));

    expect(await screen.findByText(/drama report 2/i)).toBeInTheDocument();
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith(expect.objectContaining({ organization_id: '8', page: 2 }));
    expect(mocks.getApprovalRequests.mock.calls.every(([params]) => params.per_page !== 100)).toBe(true);
  });

  it('exports with the selected organization', async () => {
    const createObjectURL = vi.fn(() => 'blob:csv');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    mocks.getApprovalRequests.mockImplementation(async (params) => page(params.organization_id === '8' ? [row(2, 8, 'Drama report')] : [row(1, 7, 'Chess report'), row(2, 8, 'Drama report')]));
    renderPage();
    await screen.findByText(/chess report/i);
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '8' } });
    await waitFor(() => expect(screen.queryByText(/chess report/i)).not.toBeInTheDocument());
    mocks.getApprovalRequests.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith(expect.objectContaining({ organization_id: '8' }));
    vi.unstubAllGlobals();
  });

  it('opens a supporting document through the authenticated helper', async () => {
    mocks.getApprovalRequests.mockResolvedValue(page([withDocuments(row(1, 7, 'Chess report'), [{ index: 0, name: 'receipts.pdf', mime_type: 'application/pdf', size: 10, open_url: '/financial-reports/9/documents/0' }])]));
    mocks.openProtectedFile.mockResolvedValue();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Review|Details/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'receipts.pdf' }));

    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/financial-reports/9/documents/0');
  });

  it('shows why a document could not be opened', async () => {
    mocks.getApprovalRequests.mockResolvedValue(page([withDocuments(row(1, 7, 'Chess report'), [{ index: 0, name: 'receipts.pdf', open_url: '/x' }])]));
    mocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Review|Details/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'receipts.pdf' }));

    expect(await screen.findByText('Allow pop-ups to open this file.')).toBeInTheDocument();
  });

  it('does not call the college endpoint or show the filter for other roles', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    respondWith(reportRequest({}));
    renderPage();

    await screen.findByText('October Financial Report');
    expect(mocks.getCollegeOrganizations).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Organization')).not.toBeInTheDocument();
  });

  it('keeps one list for the Department Head: no tabs and no New request button', async () => {
    respondWith(reportRequest({ submission_status: 'pending_department_head' }));
    renderPage('/dashboard/department-head/approvals');

    await screen.findByText('October Financial Report');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New request' })).not.toBeInTheDocument();
  });
});

const mine = { school_id: 'ADM-1' };
const requester = { first_name: 'Ana', last_name: 'Admin', school_id: 'ADM-1', role: 'ADMIN' };
const base = { organization_id: 1, requested_at: '2026-10-06T10:00:00+08:00', requested_by: 'ADM-1', requester, reviewer: null, reviewed_at: null, remarks: null };

const submittedRows = [
  { ...base, id: 11, entity_type: 'event', entity_id: 101, title: 'Foundation Day', status: 'pending', required_role: 'DEPARTMENT_HEAD', summary: { start_time: '2026-11-01', end_time: '2026-11-02', location: 'Gym', status: 'planning', requirement_files: [] } },
  { ...base, id: 12, entity_type: 'budget', entity_id: 102, title: 'Foundation Day Budget', status: 'pending', required_role: 'DEPARTMENT_HEAD', summary: { allocated_amount: 5000, remaining_amount: 5000, event_title: 'Foundation Day' } },
  { ...base, id: 13, entity_type: 'election', entity_id: 103, title: 'SBO Election 2026', status: 'pending', required_role: 'DEPARTMENT_HEAD', summary: { start_time: '2026-12-01', end_time: '2026-12-02', target_status: 'pending_approval', results_visible: false } },
  { ...base, id: 14, entity_type: 'financial_report', entity_id: 104, title: 'September Financial Report', status: 'pending', required_role: 'SUPER_ADMIN', summary: { organization: { acronym: 'CSS' }, period_start: '2026-09-01', period_end: '2026-09-30', total_income: 10, total_expense: 5, submission_status: 'pending_sao', signatories: {}, supporting_documents: [] } },
  { ...base, id: 15, entity_type: 'announcement', entity_id: 105, requested_by: 'OFF-1', requester: { first_name: 'Omar', last_name: 'Officer', school_id: 'OFF-1', role: 'SBO_OFFICER' }, title: 'Pep Rally', status: 'approved', required_role: 'ADMIN', reviewer: { first_name: 'Ana', last_name: 'Admin' }, reviewed_at: '2026-10-07T09:00:00+08:00', summary: { target_role: 'all', category: 'general', approval_status: 'approved' } },
  { ...base, id: 16, entity_type: 'payment', entity_id: 106, requested_by: 'STU-1', requester: { first_name: 'Sam', last_name: 'Student', school_id: 'STU-1', role: 'STUDENT' }, title: 'Merchandise Payment #106', status: 'pending', required_role: 'ADMIN', summary: { buyer: 'Sam Student', item: 'Shirt', total_price: 350, status: 'pending' } },
];

const reviewRows = [
  { ...base, id: 31, entity_type: 'announcement', entity_id: 205, requested_by: 'OFF-1', requester: { first_name: 'Omar', last_name: 'Officer', school_id: 'OFF-1', role: 'SBO_OFFICER' }, title: 'Blood Drive', status: 'pending', required_role: 'ADMIN', summary: { target_role: 'all', category: 'general', approval_status: 'pending' } },
  submittedRows[5],
];

function serve({ review = reviewRows, submitted = submittedRows } = {}) {
  mocks.getApprovalRequests.mockImplementation(async (params) => {
    const rows = params.scope === 'submitted' ? submitted : review;
    const filtered = params.status && params.status !== 'all' ? rows.filter((item) => item.status === params.status) : rows;
    return page(params.per_page === 1 ? [] : filtered, { per_page: params.per_page ?? 20, total: filtered.length });
  });
}

const listItems = () => within(screen.getByRole('list', { name: /Requests/ })).getAllByRole('listitem');
const rowOf = (title) => listItems().find((item) => within(item).queryByText(title));

describe('DepartmentHeadApprovalsPage for the Admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', ...mine }));
    serve();
  });

  afterEach(() => localStorage.clear());

  it('has To review and Submitted by me tabs and a New request button', async () => {
    renderPage();

    expect(await screen.findByRole('tab', { name: 'To review (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Submitted by me' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('link', { name: 'New request' })).toHaveAttribute('href', '/dashboard/approval-requests/new');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('lists what the Admin must decide under To review with a decision chip and no organization scope call', async () => {
    renderPage();

    await screen.findByText('Blood Drive');
    expect(listItems()).toHaveLength(2);
    expect(within(rowOf('Blood Drive')).getByText('Waiting for your decision')).toBeInTheDocument();
    expect(mocks.getApprovalRequests.mock.calls.every(([params]) => params.scope === undefined)).toBe(true);
  });

  it('moves between the tabs with the arrow keys and loads the submitted scope', async () => {
    renderPage();
    const reviewTab = await screen.findByRole('tab', { name: /To review/ });

    fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });

    expect(await screen.findByText('Foundation Day')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Submitted by me' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('tab=submitted');
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith(expect.objectContaining({ scope: 'submitted', status: 'all' }));
  });

  it('shows every entity type with the same stage text its entity page shows', async () => {
    renderPage('/dashboard/approvals?tab=submitted');
    await screen.findByText('Foundation Day');

    expect(listItems()).toHaveLength(6);
    const eventStage = eventLifecycle({ id: 101, status: 'planning', approval_status: 'pending', approval_required_role: 'DEPARTMENT_HEAD' }, 'ADMIN').nextAction.title;
    const budgetStage = budgetLifecycle({ id: 102, submission_status: 'pending_department_head' }, 'ADMIN').nextAction.title;
    const electionStage = electionLifecycle({ id: 103, status: 'pending_approval', approval_status: 'pending' }, 'ADMIN').nextAction.title;
    const reportStage = financialReportLifecycle({ id: 104, submission_status: 'pending_sao' }, 'ADMIN').nextAction.title;

    expect(within(rowOf('Foundation Day')).getByText(eventStage)).toBeInTheDocument();
    expect(within(rowOf('Foundation Day Budget')).getByText(budgetStage)).toBeInTheDocument();
    expect(within(rowOf('SBO Election 2026')).getByText(electionStage)).toBeInTheDocument();
    expect(within(rowOf('September Financial Report')).getByText(reportStage)).toBeInTheDocument();
    expect(eventStage).toBe('Waiting for Department Head approval');
    expect(reportStage).toBe('Waiting for SAO approval');
    expect(within(rowOf('Foundation Day')).getByRole('progressbar')).toBeInTheDocument();
    expect(within(rowOf('Pep Rally')).getByText('Approved')).toBeInTheDocument();
    expect(within(rowOf('Merchandise Payment #106')).getByText('Waiting for your decision')).toBeInTheDocument();
  });

  it('shows the SAO stage for an event the Department Head already approved', async () => {
    serve({ submitted: [{ ...submittedRows[0], status: 'approved', required_role: 'DEPARTMENT_HEAD', summary: { ...submittedRows[0].summary, requirement_files: [{ id: 1, requirement: 'Venue form', original_name: 'venue.pdf' }] } }] });
    renderPage('/dashboard/approvals?tab=submitted');

    await screen.findByText('Foundation Day');
    expect(within(rowOf('Foundation Day')).getByText('Waiting for SAO approval')).toBeInTheDocument();
  });

  it('links each row to its entity page with the record id', async () => {
    renderPage('/dashboard/approvals?tab=submitted');
    await screen.findByText('Foundation Day');

    expect(within(rowOf('Foundation Day')).getByRole('link', { name: /Open event/ })).toHaveAttribute('href', '/dashboard/events/manage-events?record=101');
    expect(within(rowOf('Foundation Day Budget')).getByRole('link', { name: /Open budget/ })).toHaveAttribute('href', '/dashboard/finance/budget-allocation?record=102');
    expect(within(rowOf('SBO Election 2026')).getByRole('link', { name: /Open election/ })).toHaveAttribute('href', '/dashboard/elections/manage-elections?record=103');
    expect(within(rowOf('September Financial Report')).getByRole('link', { name: /Open report/ })).toHaveAttribute('href', '/dashboard/finance/transaction-history?record=104');
    expect(within(rowOf('Pep Rally')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('explains how to submit when nothing has been submitted and links the New request page', async () => {
    serve({ submitted: [] });
    renderPage('/dashboard/approvals?tab=submitted');

    expect(await screen.findByText('Nothing submitted yet')).toBeInTheDocument();
    expect(screen.getByText(/tracked here, with the stage each one is at/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a new request' })).toHaveAttribute('href', '/dashboard/approval-requests/new');
  });

  it('says what will appear and who sends it when there is nothing to review', async () => {
    serve({ review: [] });
    renderPage();

    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
    expect(screen.getByText(/officers submit and student payments/)).toBeInTheDocument();
    expect(screen.getByText(/Officers send them from their own pages/)).toBeInTheDocument();
  });

  it('offers to clear filters when the filters hide everything', async () => {
    renderPage();
    await screen.findByText('Blood Drive');

    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'zzz' } });
    mocks.getApprovalRequests.mockImplementation(async (params) => page([], { per_page: params.per_page ?? 20, total: 0 }));

    expect(await screen.findByText('No requests match these filters')).toBeInTheDocument();
    mocks.getApprovalRequests.mockClear();
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByText('Blood Drive')).toBeInTheDocument();
    expect(screen.getByLabelText('Search requests')).toHaveValue('');
  });

  it('names who can act when the server refuses the list', async () => {
    mocks.getApprovalRequests.mockRejectedValue({ response: { status: 403 } });
    renderPage();

    expect(await screen.findByText('Approvals are for the Admin and the Department Head')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load approval requests.')).not.toBeInTheDocument();
  });
});

describe('DepartmentHeadApprovalsPage for an SBO officer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 'OFF-1' }));
    serve({ submitted: [submittedRows[4], { ...submittedRows[4], id: 21, title: 'Open House', status: 'pending' }] });
  });

  afterEach(() => localStorage.clear());

  it('shows only the requests the organization submitted, with no tabs, and offers New request', async () => {
    renderPage();

    expect(await screen.findByText('Open House')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New request' })).toBeInTheDocument();
    expect(mocks.getApprovalRequests.mock.calls.every(([params]) => params.scope === 'submitted')).toBe(true);
    expect(within(rowOf('Open House')).getByText('Waiting for Admin approval')).toBeInTheDocument();
    expect(within(rowOf('Pep Rally')).getByText('Approved', { selector: 'span' })).toBeInTheDocument();
  });

  it('never offers a decision on the officer own announcement', async () => {
    renderPage('/dashboard/approvals?record=21');

    const drawer = await screen.findByRole('dialog', { name: 'Open House' });
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(drawer).getByText('Waiting for Admin approval')).toBeInTheDocument();
  });
});

describe('DepartmentHeadApprovalsPage drawer', () => {
  const eventRow = { ...submittedRows[0], id: 41, requested_by: 'ADM-1', title: 'Foundation Day', status: 'pending', required_role: 'DEPARTMENT_HEAD' };
  const budgetRow = { ...submittedRows[1], id: 42, status: 'pending', required_role: 'DEPARTMENT_HEAD' };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', school_id: 'DH-1' }));
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: [{ id: 1, name: 'Chess Club' }], current_page: 1, last_page: 1, per_page: 100, total: 1 } });
    serve({ review: [eventRow, budgetRow] });
  });

  afterEach(() => localStorage.clear());

  it('opens from a fresh load on ?record= with the stepper, summary and history', async () => {
    renderPage('/dashboard/department-head/approvals?record=41');

    const drawer = await screen.findByRole('dialog', { name: 'Foundation Day' });
    expect(within(drawer).getByRole('list', { name: 'Event progress' })).toBeInTheDocument();
    expect(within(drawer).getByText('Review this event')).toBeInTheDocument();
    expect(within(drawer).getByText(/Requested by Ana Admin/)).toBeInTheDocument();
    expect(within(drawer).getByText('Waiting for Department Head to decide')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('writes ?record= when a row is opened and closes the drawer when it is cleared', async () => {
    renderPage('/dashboard/department-head/approvals');
    fireEvent.click(await screen.findByRole('button', { name: 'Review: Foundation Day' }));

    expect(await screen.findByRole('dialog', { name: 'Foundation Day' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('record=41');

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).not.toHaveTextContent('record=');
  });

  it('finds a request that is not on the loaded page by looking it up', async () => {
    mocks.getApprovalRequests.mockImplementation(async (params) => {
      if (params.per_page === 1) return page([], { per_page: 1, total: 0 });
      if (params.per_page === 100) return page([{ ...budgetRow, id: 77, title: 'Hidden Budget' }], { per_page: 100 });
      return page([eventRow]);
    });
    renderPage('/dashboard/department-head/approvals?record=77');

    expect(await screen.findByRole('dialog', { name: 'Hidden Budget' })).toBeInTheDocument();
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'all', per_page: 100, page: 1 }));
  });

  it('says the request is not available when no scope contains it', async () => {
    renderPage('/dashboard/department-head/approvals?record=999');

    expect(await screen.findByText('This request is not available to you')).toBeInTheDocument();
  });

  it('approves an event that continues to the SAO and stays open on the updated record', async () => {
    const decided = { ...eventRow, status: 'approved', reviewer: { first_name: 'Dee', last_name: 'Head' }, reviewed_at: '2026-10-08T09:00:00+08:00', remarks: null, summary: { ...eventRow.summary, status: 'planning', requirement_files: [{ id: 1, requirement: 'Venue form', original_name: 'venue.pdf' }] } };
    mocks.reviewApprovalRequest.mockResolvedValue({ data: decided });
    renderPage('/dashboard/department-head/approvals?record=41');
    const drawer = await screen.findByRole('dialog', { name: 'Foundation Day' });

    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve request' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'approved', remarks: null }));
    expect(await screen.findByText('Approved. Now with the SAO for requirements review')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Foundation Day' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for SAO approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('record=41');
  });

  it('reads plain Approved when nothing else is left to clear', async () => {
    mocks.reviewApprovalRequest.mockResolvedValue({ data: { ...budgetRow, status: 'approved', reviewed_at: '2026-10-08T09:00:00+08:00' } });
    renderPage('/dashboard/department-head/approvals?record=42');
    const drawer = await screen.findByRole('dialog', { name: 'Foundation Day Budget' });

    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Approve request' })).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approved', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/Now with the SAO/)).not.toBeInTheDocument();
  });

  it('requires remarks to reject, and keeps the drawer open when the confirmation is cancelled', async () => {
    mocks.reviewApprovalRequest.mockResolvedValue({ data: { ...eventRow, status: 'rejected', remarks: 'Pick another date.' } });
    renderPage('/dashboard/department-head/approvals?record=41');
    const drawer = await screen.findByRole('dialog', { name: 'Foundation Day' });

    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reject request' });
    expect(within(confirm).getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(within(confirm).getByLabelText(/Remarks \(required\)/)).toBeRequired();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reject request' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Foundation Day' })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Foundation Day' })).getByRole('button', { name: 'Reject' }));
    const again = await screen.findByRole('dialog', { name: 'Reject request' });
    fireEvent.change(within(again).getByLabelText(/Remarks/), { target: { value: 'Pick another date.' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'rejected', remarks: 'Pick another date.' }));
    expect(await screen.findByText('Rejected. Returned to the organization for changes')).toBeInTheDocument();
    expect(screen.getByText('Pick another date.')).toBeInTheDocument();
  });

  it('uses Back-style closing: Escape on the drawer clears the record', async () => {
    renderPage('/dashboard/department-head/approvals?record=41');
    await screen.findByRole('dialog', { name: 'Foundation Day' });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).not.toHaveTextContent('record=');
  });
});

describe('DepartmentHeadApprovalsPage entity links stay on routes the role may open', () => {
  const routes = readFileSync(resolve(process.cwd(), '../server/config/client_routes.php'), 'utf8');
  const allowedFor = (role) => {
    const block = routes.match(new RegExp(`'${role}' => \\[([^\\]]*)\\]`))[1];
    return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  };
  const types = submittedRows.slice(0, 4);

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => localStorage.clear());

  it.each(['ADMIN', 'DEPARTMENT_HEAD', 'SBO_OFFICER'])('%s gets only links to routes in its own client route list', async (role) => {
    localStorage.setItem('user', JSON.stringify({ role, school_id: 'X-1' }));
    serve({ review: types, submitted: types });
    renderPage(role === 'SBO_OFFICER' ? '/dashboard/approvals' : '/dashboard/approvals?tab=submitted');
    await screen.findByText('Foundation Day');

    const hrefs = within(screen.getByRole('list', { name: /Requests/ })).getAllByRole('link').map((link) => link.getAttribute('href').split('?')[0]);
    expect(hrefs).toHaveLength(4);
    hrefs.forEach((href) => expect(allowedFor(role)).toContain(href));
  });

  it('points the Department Head at the read-only pages their sidebar has', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', school_id: 'DH-1' }));
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 100, total: 0 } });
    serve({ review: types });
    renderPage('/dashboard/department-head/approvals');
    await screen.findByText('Foundation Day');

    expect(within(rowOf('Foundation Day')).getByRole('link', { name: /Open event/ })).toHaveAttribute('href', '/dashboard/events/activity-calendar?record=101');
    expect(within(rowOf('SBO Election 2026')).getByRole('link', { name: /Open election/ })).toHaveAttribute('href', '/dashboard/elections/election-results');
  });

  it('shows no link for a role that cannot open the entity page', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', school_id: 'S-1' }));
    serve({ review: types });
    renderPage();
    await screen.findByText('Foundation Day');

    expect(within(screen.getByRole('list', { name: /Requests/ })).queryAllByRole('link')).toHaveLength(0);
  });
});
