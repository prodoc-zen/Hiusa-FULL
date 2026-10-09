import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoOrganizationOverviewPage from './SaoOrganizationOverviewPage';

const mocks = vi.hoisted(() => ({ getSystemOrganizationOverview: vi.fn(), restoreSystemOrganization: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => mocks);
const complianceMocks = vi.hoisted(() => ({ getComplianceDocuments: vi.fn() }));
vi.mock('../../../services/complianceService', () => complianceMocks);
const fileMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => fileMocks);

const overview = (status = 'active', extra = {}) => ({
  organization: { id: 5, name: 'Computing Society', acronym: 'CS', slug: 'computing-society', description: 'Builds software.', color: '#0B8ED0', logo_url: null, college: 'College of Computing', college_id: 1, is_active: status === 'active', lifecycle_status: status },
  lifecycle: { status, review_remarks: null, submitted_at: null, submitted_by: null, reviewed_at: null, reviewed_by: null, archived_at: null, archived_by: null, ...extra },
  leadership: [{ school_id: 1, name: 'Ana Reyes', role: 'ADMIN', position_title: 'President', account_status: 'active' }],
  member_counts: { STUDENT: 8, SBO_OFFICER: 3, ADMIN: 1, total: 12 },
  events: { upcoming: [{ id: 1, title: 'Hack Night', status: 'approved', start_time: '2026-11-01T10:00:00Z', end_time: '2026-11-01T12:00:00Z', location: 'Lab 1' }], recent: [] },
  budget: { approved_budget_count: 2, allocated: 10000, spent: 2500, income: 500, remaining: 8000 },
  compliance: { accreditation_status: 'pending_review', pending_documents_count: 4 },
  pending_approvals_count: 3,
  documents: [],
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/dashboard/super-admin/organizations/5']}>
    <Routes><Route path="/dashboard/super-admin/organizations/:organizationId" element={<SaoOrganizationOverviewPage />} /></Routes>
  </MemoryRouter>,
);

describe('SaoOrganizationOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemOrganizationOverview.mockResolvedValue(overview());
    complianceMocks.getComplianceDocuments.mockResolvedValue({ data: { data: [{ source: 'compliance', item: 'Constitution', status: 'approved', file_name: 'constitution.pdf', submitted_at: '2026-09-01T08:00:00Z', open_url: '/compliance/submissions/9/document' }] } });
  });

  it('renders the read-only overview sections', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Computing Society' })).toBeInTheDocument();
    expect(screen.getByText('CS · College of Computing')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Active')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Leadership' })).getByText('Ana Reyes')).toBeInTheDocument();
    const members = screen.getByRole('region', { name: 'Members by role' });
    expect(within(members).getByText('Total').nextSibling).toHaveTextContent('12');
    expect(within(screen.getByRole('region', { name: 'Events' })).getByText('Hack Night')).toBeInTheDocument();
    const budgets = screen.getByRole('region', { name: 'Approved budgets' });
    expect(within(budgets).getByText('Allocated').nextSibling).toHaveTextContent('₱10,000.00');
    expect(within(budgets).getByText('Remaining').nextSibling).toHaveTextContent('₱8,000.00');
    const compliance = screen.getByRole('region', { name: 'Compliance' });
    expect(within(compliance).getByText('Pending review')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Pending approvals' })).getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to agency overview/ })).toHaveAttribute('href', '/dashboard/super-admin/agency');
  });

  it('has no edit or restore controls for an active organization', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /edit|restore|archive/i })).not.toBeInTheDocument();
  });

  it('lists latest documents and opens one through the protected file helper', async () => {
    fileMocks.openProtectedFile.mockResolvedValue();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open constitution.pdf' }));
    expect(complianceMocks.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 5, source: 'compliance' }));
    await waitFor(() => expect(fileMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/9/document'));
  });

  it('shows the open error when a document cannot be opened', async () => {
    fileMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open constitution.pdf' }));
    expect(await screen.findByText('Allow pop-ups to open this file.')).toBeInTheDocument();
  });

  it('shows an empty documents state', async () => {
    complianceMocks.getComplianceDocuments.mockResolvedValue({ data: { data: [] } });
    renderPage();
    expect(await screen.findByText('No documents have been submitted.')).toBeInTheDocument();
  });

  it('shows a documents error with retry that does not hide the rest of the page', async () => {
    complianceMocks.getComplianceDocuments.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderPage();
    const section = await screen.findByRole('region', { name: 'Latest documents' });
    fireEvent.click(await within(section).findByRole('button', { name: 'Try again' }));
    expect(await within(section).findByText(/constitution.pdf/)).toBeInTheDocument();
  });

  it('shows the read-only banner and restores an archived organization', async () => {
    mocks.getSystemOrganizationOverview.mockResolvedValue(overview('archived', { archived_at: '2026-10-01T00:00:00Z', archived_by: { school_id: 2, name: 'SAO Officer' } }));
    mocks.restoreSystemOrganization.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText(/Archived organizations are read-only. Restore to make changes./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore organization' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Restore organization' })).getByRole('button', { name: 'Restore organization' }));
    await waitFor(() => expect(mocks.restoreSystemOrganization).toHaveBeenCalledWith('5'));
    expect(await screen.findByRole('status')).toHaveTextContent('Organization restored.');
  });

  it('shows the server message and reloads when restore conflicts', async () => {
    mocks.getSystemOrganizationOverview.mockResolvedValue(overview('archived'));
    mocks.restoreSystemOrganization.mockRejectedValue({ response: { status: 409, data: { message: 'Only an archived organization can be restored.' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore organization' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Restore organization' })).getByRole('button', { name: 'Restore organization' }));
    expect(await screen.findByText('Only an archived organization can be restored.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getSystemOrganizationOverview).toHaveBeenCalledTimes(2));
  });

  it('shows returned remarks and the pending note', async () => {
    mocks.getSystemOrganizationOverview.mockResolvedValue(overview('returned', { review_remarks: 'Attach the signed constitution.' }));
    const { unmount } = renderPage();
    expect(await screen.findByText('Attach the signed constitution.')).toBeInTheDocument();
    unmount();
    mocks.getSystemOrganizationOverview.mockResolvedValue(overview('pending'));
    renderPage();
    expect(await screen.findByText(/waiting for SAO review/)).toBeInTheDocument();
  });

  it('shows an error with retry and a way back', async () => {
    mocks.getSystemOrganizationOverview.mockRejectedValueOnce({ response: { status: 404, data: { message: 'Not found.' } } });
    renderPage();
    expect(await screen.findByText('Not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to agency overview/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Computing Society' })).toBeInTheDocument();
  });
});
