import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemOrganizationsPage from './SystemOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getSystemOrganizations: vi.fn(), getSystemColleges: vi.fn(), getSystemAgency: vi.fn(), getSystemOrganizationOverview: vi.fn(),
  reviewSystemOrganization: vi.fn(), archiveSystemOrganization: vi.fn(), restoreSystemOrganization: vi.fn(),
  updateSystemOrganization: vi.fn(), uploadSystemOrganizationLogo: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);
const profileMocks = vi.hoisted(() => ({ getProfileCandidates: vi.fn(), inviteAccountProfile: vi.fn(), getManagedAccountProfiles: vi.fn(), deleteAccountProfile: vi.fn() }));
vi.mock('../../../services/authService', () => profileMocks);
const complianceMocks = vi.hoisted(() => ({ getComplianceDocuments: vi.fn() }));
vi.mock('../../../services/complianceService', () => complianceMocks);
const fileMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => fileMocks);

const SUBMITTED_AT = '2026-10-01T08:30:00.000000Z';
const org = (overrides = {}) => ({ id: 3, name: 'Main SBO', acronym: 'SBO', college: 'College of Arts', college_id: 1, lifecycle_status: 'active', is_active: true, users_count: 0, administrators: [], ...overrides });
const pageOf = (data) => ({ data, current_page: 1, last_page: 1 });
const agency = (pending = 0) => ({ totals: { colleges: 1, organizations: 5, by_lifecycle_status: { pending, returned: 1, active: 3, archived: 1 } } });

function Probe() {
  const location = useLocation();
  return <p data-testid="search">{location.search}</p>;
}
const renderPage = (entry = '/dashboard/super-admin/organizations') => render(<MemoryRouter initialEntries={[entry]}><SystemOrganizationsPage /><Probe /></MemoryRouter>);
const lastStatusParam = () => mocks.getSystemOrganizations.mock.calls.filter(([params]) => params.search !== undefined).at(-1)[0].lifecycle_status;

describe('SystemOrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemAgency.mockResolvedValue(agency(0));
    mocks.getSystemColleges.mockResolvedValue([{ id: 1, name: 'College of Arts', is_active: true }, { id: 2, name: 'College of Science', is_active: true }]);
    mocks.getSystemOrganizations.mockImplementation(async (params) => pageOf(params.lifecycle_status === 'pending' ? [] : [org()]));
    mocks.getSystemOrganizationOverview.mockResolvedValue({ lifecycle: { submitted_by: { school_id: 9, name: 'Dean Reyes' } } });
    complianceMocks.getComplianceDocuments.mockResolvedValue({ data: pageOf([{ source: 'compliance', item: 'Constitution', file_name: 'constitution.pdf', submitted_at: SUBMITTED_AT, open_url: '/compliance/submissions/5/document' }]) });
    profileMocks.getProfileCandidates.mockResolvedValue({ data: { data: [{ school_id: 123, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test' }], current_page: 1, last_page: 1, total: 1 } });
    profileMocks.inviteAccountProfile.mockResolvedValue({ data: { id: 9, organization_id: 3 } });
    profileMocks.getManagedAccountProfiles.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0 } });
  });

  describe('status tabs', () => {
    it('defaults to Active when nothing is pending and keeps ?status in the URL', async () => {
      renderPage();
      expect(await screen.findByText('Main SBO')).toBeInTheDocument();
      expect(lastStatusParam()).toBe('active');
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?status=active'));
      expect(screen.getByRole('tab', { name: 'Active (3)' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Active' })).toContainElement(screen.getByText('Main SBO'));
      expect(screen.getByRole('tab', { name: 'Active (3)' })).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
    });

    it('labels the search field visibly', async () => {
      renderPage();
      await screen.findByText('Main SBO');
      const input = screen.getByLabelText('Search organizations');
      expect(input.labels[0]).toHaveTextContent('Search organizations');
      expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    });

    it('debounces search and ignores responses that arrive out of order', async () => {
      let releaseSlow;
      mocks.getSystemOrganizations.mockImplementation((params) => {
        if (params.search === 'slow') return new Promise((resolve) => { releaseSlow = () => resolve(pageOf([org({ id: 11, name: 'Slow Club' })])); });
        if (params.search === 'fast') return Promise.resolve(pageOf([org({ id: 12, name: 'Fast Club' })]));
        return Promise.resolve(pageOf([org()]));
      });
      renderPage();
      await screen.findByText('Main SBO');
      const searchCalls = () => mocks.getSystemOrganizations.mock.calls.filter(([params]) => params.search !== undefined).map(([params]) => params.search);
      const input = screen.getByLabelText('Search organizations');
      fireEvent.change(input, { target: { value: 's' } });
      fireEvent.change(input, { target: { value: 'sl' } });
      fireEvent.change(input, { target: { value: 'slow' } });
      expect(searchCalls()).toEqual(['']);
      await waitFor(() => expect(searchCalls()).toEqual(['', 'slow']));
      fireEvent.change(input, { target: { value: 'fast' } });
      expect(await screen.findByText('Fast Club')).toBeInTheDocument();
      releaseSlow();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(screen.getByText('Fast Club')).toBeInTheDocument();
      expect(screen.queryByText('Slow Club')).not.toBeInTheDocument();
      expect(searchCalls()).toEqual(['', 'slow', 'fast']);
    });

    it('defaults to Pending review when organizations are waiting', async () => {
      mocks.getSystemAgency.mockResolvedValue(agency(2));
      renderPage();
      expect(await screen.findByText('No organizations are waiting for review.')).toBeInTheDocument();
      expect(lastStatusParam()).toBe('pending');
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?status=pending'));
    });

    it('honours ?status and switches tabs', async () => {
      renderPage('/dashboard/super-admin/organizations?status=returned');
      await screen.findByText('Main SBO');
      expect(lastStatusParam()).toBe('returned');
      fireEvent.click(screen.getByRole('tab', { name: /^Archived/ }));
      await waitFor(() => expect(lastStatusParam()).toBe('archived'));
      expect(screen.getByTestId('search')).toHaveTextContent('?status=archived');
    });

    it('has no create flow', async () => {
      renderPage();
      await screen.findByText('Main SBO');
      expect(screen.queryByRole('button', { name: /add organization|new organization/i })).not.toBeInTheDocument();
    });
  });

  describe('active organizations', () => {
    it('opens searchable membership from the organization action menu', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add existing user' }));
      expect(screen.getByRole('dialog', { name: 'Add existing user' })).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('radio', { name: /Ana Reyes/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
      await waitFor(() => expect(profileMocks.inviteAccountProfile).toHaveBeenCalledWith({ organization_id: 3, school_id: 123, role: 'STUDENT' }));
      expect(await screen.findByRole('status')).toHaveTextContent('User added to the organization.');
    });

    it('adds users from the organization editor and preserves unsaved edits when returning', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit organization' }));
      fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Changed name' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add existing user' }));
      expect(screen.queryByRole('dialog', { name: 'Edit organization' })).not.toBeInTheDocument();
      expect(await screen.findByRole('radio', { name: /Ana Reyes/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
      expect(screen.getByLabelText('Organization name')).toHaveValue('Changed name');
    });

    it('opens profile management from the editor and preserves unsaved changes', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit organization' }));
      fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Unsaved change' } });
      fireEvent.click(screen.getByRole('button', { name: 'Manage user profiles' }));
      expect(await screen.findByText('No profiles found in the organizations you manage.')).toBeInTheDocument();
      expect(profileMocks.getManagedAccountProfiles).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 3 }));
      fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
      expect(screen.getByLabelText('Organization name')).toHaveValue('Unsaved change');
    });

    it('saves an edit with the college id', async () => {
      mocks.updateSystemOrganization.mockResolvedValue(org());
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit organization' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit organization' });
      fireEvent.change(within(dialog).getByLabelText('College'), { target: { value: '2' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save organization' }));
      await waitFor(() => expect(mocks.updateSystemOrganization).toHaveBeenCalledWith(3, expect.objectContaining({ college_id: 2, name: 'Main SBO' })));
    });

    it('has no Active organization checkbox and never sends is_active', async () => {
      mocks.updateSystemOrganization.mockResolvedValue(org());
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit organization' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit organization' });
      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(dialog).queryByText('Active organization')).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save organization' }));
      await waitFor(() => expect(mocks.updateSystemOrganization).toHaveBeenCalled());
      expect(mocks.updateSystemOrganization.mock.calls[0][1]).not.toHaveProperty('is_active');
    });

    it('archives with an optional reason', async () => {
      mocks.archiveSystemOrganization.mockResolvedValue({});
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Archive organization' }));
      const dialog = screen.getByRole('dialog', { name: 'Archive organization' });
      fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Inactive for two terms' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Archive organization' }));
      await waitFor(() => expect(mocks.archiveSystemOrganization).toHaveBeenCalledWith(3, { reason: 'Inactive for two terms' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Main SBO archived.');
    });

    it('archives without a reason', async () => {
      mocks.archiveSystemOrganization.mockResolvedValue({});
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Archive organization' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Archive organization' })).getByRole('button', { name: 'Archive organization' }));
      await waitFor(() => expect(mocks.archiveSystemOrganization).toHaveBeenCalledWith(3, {}));
    });
  });

  describe('pending review', () => {
    const pendingRow = org({ id: 8, name: 'Robotics Club', acronym: 'RC', lifecycle_status: 'pending', is_active: false, submitted_at: SUBMITTED_AT, description: 'Builds robots.' });
    beforeEach(() => {
      mocks.getSystemOrganizations.mockImplementation(async (params) => pageOf(params.lifecycle_status === 'pending' ? [pendingRow] : []));
    });
    const openReview = async () => {
      renderPage('/dashboard/super-admin/organizations?status=pending');
      fireEvent.click(await screen.findByRole('button', { name: 'Review Robotics Club' }));
      return screen.findByRole('dialog', { name: 'Review registration' });
    };

    it('shows registration details, submitter and documents, and opens a file', async () => {
      const drawer = await openReview();
      expect(await within(drawer).findByText('Dean Reyes')).toBeInTheDocument();
      expect(within(drawer).getByText('Builds robots.')).toBeInTheDocument();
      expect(within(drawer).getByText('College of Arts')).toBeInTheDocument();
      expect(complianceMocks.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 8, source: 'compliance' }));
      fileMocks.openProtectedFile.mockResolvedValue();
      fireEvent.click(await within(drawer).findByRole('button', { name: 'Open constitution.pdf' }));
      await waitFor(() => expect(fileMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/5/document'));
    });

    it('shows a message when a file cannot be opened', async () => {
      fileMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
      const drawer = await openReview();
      fireEvent.click(await within(drawer).findByRole('button', { name: 'Open constitution.pdf' }));
      expect(await within(drawer).findByText('Allow pop-ups to open this file.')).toBeInTheDocument();
    });

    it('requires remarks to return and sends submitted_at exactly as received', async () => {
      mocks.reviewSystemOrganization.mockResolvedValue({});
      const drawer = await openReview();
      await within(drawer).findByText('Dean Reyes');
      await new Promise((resolve) => { window.requestAnimationFrame(() => resolve()); });
      fireEvent.click(within(drawer).getByRole('button', { name: 'Return' }));
      expect(await within(drawer).findByText(/Add remarks explaining/)).toBeInTheDocument();
      expect(within(drawer).getByLabelText(/Remarks/)).toHaveFocus();
      expect(mocks.reviewSystemOrganization).not.toHaveBeenCalled();
      fireEvent.change(within(drawer).getByLabelText(/Remarks/), { target: { value: 'Attach the signed constitution.' } });
      fireEvent.click(within(drawer).getByRole('button', { name: 'Return' }));
      await waitFor(() => expect(mocks.reviewSystemOrganization).toHaveBeenCalledWith(8, { decision: 'return', remarks: 'Attach the signed constitution.', submitted_at: SUBMITTED_AT }));
      expect(await screen.findByRole('status')).toHaveTextContent('returned to its Department Head');
    });

    it('approves with submitted_at and refreshes the list', async () => {
      mocks.reviewSystemOrganization.mockResolvedValue({});
      const drawer = await openReview();
      await within(drawer).findByText('Dean Reyes');
      const before = mocks.getSystemOrganizations.mock.calls.length;
      fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(mocks.reviewSystemOrganization).toHaveBeenCalledWith(8, { decision: 'approve', submitted_at: SUBMITTED_AT }));
      expect(await screen.findByRole('status')).toHaveTextContent('Robotics Club approved and activated.');
      await waitFor(() => expect(mocks.getSystemOrganizations.mock.calls.length).toBeGreaterThan(before));
    });

    it('shows the server message and reloads on a 409', async () => {
      mocks.reviewSystemOrganization.mockRejectedValue({ response: { status: 409, data: { message: 'This registration changed. Review it again.' } } });
      const drawer = await openReview();
      await within(drawer).findByText('Dean Reyes');
      const before = mocks.getSystemOrganizations.mock.calls.length;
      fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('This registration changed. Review it again.')).toBeInTheDocument();
      await waitFor(() => expect(mocks.getSystemOrganizations.mock.calls.length).toBeGreaterThan(before));
    });

    it('keeps the drawer open and shows other errors', async () => {
      mocks.reviewSystemOrganization.mockRejectedValue({ response: { status: 500, data: {} } });
      const drawer = await openReview();
      await within(drawer).findByText('Dean Reyes');
      fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
      expect(await within(drawer).findByText('Could not save your decision.')).toBeInTheDocument();
    });

    it('offers a retry when the registration details fail to load', async () => {
      mocks.getSystemOrganizationOverview.mockRejectedValueOnce({ response: { status: 500, data: {} } });
      const drawer = await openReview();
      fireEvent.click(await within(drawer).findByRole('button', { name: 'Try again' }));
      expect(await within(drawer).findByText('Dean Reyes')).toBeInTheDocument();
    });

    it('disables Approve with a reason while the registration details failed to load', async () => {
      mocks.getSystemOrganizationOverview.mockRejectedValueOnce({ response: { status: 500, data: {} } });
      const drawer = await openReview();
      const retry = await within(drawer).findByRole('button', { name: 'Try again' });
      expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeDisabled();
      expect(within(drawer).getByText('Approve is unavailable until the registration details load.')).toBeInTheDocument();
      fireEvent.click(retry);
      await within(drawer).findByText('Dean Reyes');
      expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeEnabled();
      expect(within(drawer).queryByText('Approve is unavailable until the registration details load.')).not.toBeInTheDocument();
    });

    it('opens the review drawer for ?review once and drops the param', async () => {
      renderPage('/dashboard/super-admin/organizations?status=pending&review=8');
      const drawer = await screen.findByRole('dialog', { name: 'Review registration' });
      expect(within(drawer).getByText('Robotics Club (RC)')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('search')).not.toHaveTextContent('review='));
      expect(screen.getByTestId('search')).toHaveTextContent('status=pending');
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('opens the review drawer for an organization that is not on the loaded page', async () => {
      mocks.getSystemOrganizations.mockImplementation(async () => pageOf([]));
      mocks.getSystemOrganizationOverview.mockResolvedValue({
        organization: { id: 9, name: 'Far Club', acronym: 'FC', college: 'College of Arts', description: 'Far away.' },
        lifecycle: { status: 'pending', submitted_at: SUBMITTED_AT, submitted_by: { name: 'Dean Reyes' } },
      });
      renderPage('/dashboard/super-admin/organizations?status=pending&review=9');
      const drawer = await screen.findByRole('dialog', { name: 'Review registration' });
      expect(within(drawer).getByText('Far Club (FC)')).toBeInTheDocument();
    });

    it('says so when the organization in ?review is no longer pending', async () => {
      mocks.getSystemOrganizations.mockImplementation(async () => pageOf([]));
      mocks.getSystemOrganizationOverview.mockResolvedValue({ organization: { id: 9, name: 'Old Club' }, lifecycle: { status: 'active' } });
      renderPage('/dashboard/super-admin/organizations?status=pending&review=9');
      expect(await screen.findByRole('alert')).toHaveTextContent('Old Club is no longer waiting for review.');
      expect(screen.queryByRole('dialog', { name: 'Review registration' })).not.toBeInTheDocument();
    });
  });

  it('shows returned remarks read-only with no actions menu', async () => {
    mocks.getSystemOrganizations.mockResolvedValue(pageOf([org({ lifecycle_status: 'returned', is_active: false, review_remarks: 'Add the adviser signature.' })]));
    renderPage('/dashboard/super-admin/organizations?status=returned');
    expect(await screen.findByText('Add the adviser signature.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review|Archive|Restore/ })).not.toBeInTheDocument();
  });

  describe('archived tab', () => {
    beforeEach(() => {
      mocks.getSystemOrganizations.mockResolvedValue(pageOf([org({ lifecycle_status: 'archived', is_active: false })]));
    });

    it('is read-only with only Open and Restore', async () => {
      renderPage('/dashboard/super-admin/organizations?status=archived');
      expect(await screen.findByText('Archived organizations are read-only. Restore to make changes.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Actions for|Edit|Archive organization|Review/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open Main SBO' })).toHaveAttribute('href', '/dashboard/super-admin/organizations/3');
      expect(screen.getByRole('button', { name: 'Restore Main SBO' })).toBeInTheDocument();
    });

    it('is visibly muted and announced as read only', async () => {
      renderPage('/dashboard/super-admin/organizations?status=archived');
      const badge = await screen.findByLabelText('Archived, read only');
      expect(badge).toHaveTextContent('Archived');
      expect(badge.closest('article')).toHaveClass('bg-subtle');
    });

    it('restores after confirmation', async () => {
      mocks.restoreSystemOrganization.mockResolvedValue({});
      renderPage('/dashboard/super-admin/organizations?status=archived');
      fireEvent.click(await screen.findByRole('button', { name: 'Restore Main SBO' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Restore organization' })).getByRole('button', { name: 'Restore organization' }));
      await waitFor(() => expect(mocks.restoreSystemOrganization).toHaveBeenCalledWith(3));
      expect(await screen.findByRole('status')).toHaveTextContent('Main SBO restored.');
    });

    it('shows the server message and reloads when restore conflicts', async () => {
      mocks.restoreSystemOrganization.mockRejectedValue({ response: { status: 409, data: { message: 'Only an archived organization can be restored.' } } });
      renderPage('/dashboard/super-admin/organizations?status=archived');
      fireEvent.click(await screen.findByRole('button', { name: 'Restore Main SBO' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Restore organization' })).getByRole('button', { name: 'Restore organization' }));
      expect(await screen.findByText('Only an archived organization can be restored.')).toBeInTheDocument();
    });
  });

  it('shows an error with retry', async () => {
    mocks.getSystemOrganizations.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderPage('/dashboard/super-admin/organizations?status=active');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Main SBO')).toBeInTheDocument();
  });

  it('shows an empty state per tab', async () => {
    mocks.getSystemOrganizations.mockResolvedValue(pageOf([]));
    renderPage('/dashboard/super-admin/organizations?status=archived');
    expect(await screen.findByText('No archived organizations.')).toBeInTheDocument();
  });
});
