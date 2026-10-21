import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoOrganizationOverviewPage from './SaoOrganizationOverviewPage';

const mocks = vi.hoisted(() => ({ getSystemOrganizationOverview: vi.fn(), restoreSystemOrganization: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => mocks);
const complianceMocks = vi.hoisted(() => ({ getComplianceDocuments: vi.fn() }));
vi.mock('../../../services/complianceService', () => complianceMocks);
const fileMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => fileMocks);
const refetchHook = vi.hoisted(() => ({ current: null }));
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: (refetch) => { refetchHook.current = refetch; } }));

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
    expect(screen.getByRole('link', { name: /Back to colleges/ })).toHaveAttribute('href', '/dashboard/super-admin/colleges');
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
    expect(await screen.findByText('Your remarks: Attach the signed constitution.')).toBeInTheDocument();
    unmount();
    mocks.getSystemOrganizationOverview.mockResolvedValue(overview('pending'));
    renderPage();
    expect(await screen.findByText('Review this registration')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review registration' })).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending&review=5');
  });

  describe('registration progress', () => {
    const progress = async () => within(await screen.findByRole('region', { name: 'Registration progress' }));
    const stage = (view) => view.getByRole('list', { name: 'Registration progress for Computing Society' });

    it('shows the SAO review step and a Review this registration action for a pending registration', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('pending'));
      renderPage();
      const view = await progress();

      expect(within(stage(view)).getByText('SAO approval').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(view.getByText('Review this registration')).toBeInTheDocument();
      expect(view.getByRole('link', { name: 'Review registration' })).toBeInTheDocument();
    });

    it('waits for the Department Head with the SAO remarks after a return', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('returned', { review_remarks: 'Attach the signed constitution.' }));
      renderPage();
      const view = await progress();

      expect(view.getByText('Waiting for the Department Head to resubmit')).toBeInTheDocument();
      expect(view.getByText('Your remarks: Attach the signed constitution.')).toBeInTheDocument();
      expect(view.queryByRole('link')).not.toBeInTheDocument();
    });

    it('asks the SAO to provision an administrator when an active organization has none', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue({ ...overview('active'), leadership: [], member_counts: { STUDENT: 0, SBO_OFFICER: 0, ADMIN: 0, total: 0 } });
      renderPage();
      const view = await progress();

      expect(within(stage(view)).getByText('Admin account').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(view.getByText('Add the first Admin account')).toBeInTheDocument();
      expect(view.getByRole('link', { name: 'Add Admin account' })).toHaveAttribute('href', '/dashboard/super-admin/admins?organization=5&create=1');
      expect(screen.getByText(/Add the first Admin account so the organization can sign in/)).toBeInTheDocument();
    });

    it('shows a complete stepper and the administrator state once an administrator exists', async () => {
      renderPage();
      const view = await progress();

      expect(within(stage(view)).getAllByText(/^Done:/)).toHaveLength(4);
      expect(view.getByText('Active: administrator can sign in')).toBeInTheDocument();
    });

    it('shows the stepper without a callout for an archived organization', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('archived'));
      renderPage();
      const view = await progress();

      expect(within(stage(view)).getAllByText(/^Skipped:/)).toHaveLength(1);
      expect(within(stage(view)).getAllByText(/^Stopped:/)).toHaveLength(1);
      expect(view.queryByText(/Active: administrator can sign in/)).not.toBeInTheDocument();
    });
  });

  it('links to the compliance queues instead of dead ending', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    const compliance = screen.getByRole('region', { name: 'Compliance' });
    expect(within(compliance).getByRole('link', { name: 'Open the review queue' })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=review');
    const documents = screen.getByRole('region', { name: 'Latest documents' });
    expect(within(documents).getByRole('link', { name: 'View all documents' })).toHaveAttribute('href', '/dashboard/super-admin/documents');
    expect(within(screen.getByRole('region', { name: 'Pending approvals' })).queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the admin count and accreditation status on the overview', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(within(screen.getByRole('region', { name: 'Members by role' })).getByText('Admins').nextSibling).toHaveTextContent('1');
    expect(within(screen.getByRole('region', { name: 'Compliance' })).getByText('Pending review')).toBeInTheDocument();
  });

  it('shows an error with retry and a way back', async () => {
    mocks.getSystemOrganizationOverview.mockRejectedValueOnce({ response: { status: 404, data: { message: 'Not found.' } } });
    renderPage();
    expect(await screen.findByText('Not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to colleges/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Computing Society' })).toBeInTheDocument();
  });

  describe('silent refresh while the tab stays open', () => {
    it('shows the new figures and documents without a loading state, and keeps the open restore dialog', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('archived'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Restore organization' }));
      expect(screen.getByRole('dialog', { name: 'Restore organization' })).toBeInTheDocument();
      await screen.findByText(/constitution.pdf/);

      let release;
      mocks.getSystemOrganizationOverview.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      complianceMocks.getComplianceDocuments.mockResolvedValueOnce({ data: { data: [{ source: 'compliance', item: 'Budget plan', status: 'approved', file_name: 'budget-plan.pdf', submitted_at: '2026-10-02T08:00:00Z', open_url: '/compliance/submissions/10/document' }] } });
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(screen.queryByText('Loading documents...')).not.toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Members by role' })).getByText('Total').nextSibling).toHaveTextContent('12');

      await act(async () => {
        release({ ...overview('archived'), member_counts: { STUDENT: 16, SBO_OFFICER: 3, ADMIN: 1, total: 20 } });
        await refresh;
      });

      expect(within(screen.getByRole('region', { name: 'Members by role' })).getByText('Total').nextSibling).toHaveTextContent('20');
      expect(await screen.findByText(/budget-plan.pdf/)).toBeInTheDocument();
      expect(screen.queryByText('Loading documents...')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Restore organization' })).toBeInTheDocument();
    });

    it('keeps the page and the documents and shows no error when the silent refresh fails', async () => {
      renderPage();
      await screen.findByText(/constitution.pdf/);

      mocks.getSystemOrganizationOverview.mockRejectedValueOnce(new Error('offline'));
      complianceMocks.getComplianceDocuments.mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await refetchHook.current(); });
      await act(async () => { await Promise.resolve(); });

      expect(screen.getByRole('heading', { level: 1, name: 'Computing Society' })).toBeInTheDocument();
      expect(screen.getByText(/constitution.pdf/)).toBeInTheDocument();
      expect(screen.queryByText('Organization unavailable')).not.toBeInTheDocument();
      expect(screen.queryByText('Unable to load documents.')).not.toBeInTheDocument();
    });

    it('does not clear the restore notice when a silent refresh succeeds', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('archived'));
      mocks.restoreSystemOrganization.mockResolvedValue({});
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Restore organization' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Restore organization' })).getByRole('button', { name: 'Restore organization' }));
      expect(await screen.findByText('Organization restored.')).toBeInTheDocument();

      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('Organization restored.')).toBeInTheDocument();
    });

    it('drops a silent response that arrives after a newer full load', async () => {
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('archived'));
      mocks.restoreSystemOrganization.mockResolvedValue({});
      renderPage();
      await screen.findByRole('button', { name: 'Restore organization' });

      let releaseSilent;
      mocks.getSystemOrganizationOverview.mockReturnValueOnce(new Promise((resolve) => { releaseSilent = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      mocks.getSystemOrganizationOverview.mockResolvedValue(overview('active'));
      fireEvent.click(screen.getByRole('button', { name: 'Restore organization' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Restore organization' })).getByRole('button', { name: 'Restore organization' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore organization' })).not.toBeInTheDocument());

      await act(async () => {
        releaseSilent(overview('archived'));
        await refresh;
      });

      expect(screen.queryByRole('button', { name: 'Restore organization' })).not.toBeInTheDocument();
    });
  });
});
