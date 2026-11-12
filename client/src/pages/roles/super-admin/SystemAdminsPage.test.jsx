import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemAdminsPage from './SystemAdminsPage';

const serviceMocks = vi.hoisted(() => ({
  getSystemAdmins: vi.fn(),
  getSystemOrganizations: vi.fn(),
  getSystemOrganizationOverview: vi.fn(),
  deleteSystemAdmin: vi.fn(),
  updateSystemAdmin: vi.fn(),
  initiateSystemAdminPasswordReset: vi.fn(),
}));

vi.mock('../../../services/systemAdministrationService', () => serviceMocks);
const profileMocks = vi.hoisted(() => ({ getProfileOrganizations: vi.fn(), inviteAccountProfile: vi.fn(), getProfileCandidates: vi.fn(), getManagedAccountProfiles: vi.fn(), deleteAccountProfile: vi.fn() }));
vi.mock('../../../services/authService', () => profileMocks);
const peopleMocks = vi.hoisted(() => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/peopleService', () => peopleMocks);
const refetchHook = vi.hoisted(() => ({ current: null }));
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: (refetch) => { refetchHook.current = refetch; } }));

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

const renderPage = (entry = '/dashboard/super-admin/admins') => render(<MemoryRouter initialEntries={[entry]}><SystemAdminsPage /><Probe /></MemoryRouter>);

async function pickMaria(dialog) {
  fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Student' }), { target: { value: 'maria' } });
  fireEvent.click(await within(dialog).findByRole('option', { name: /Maria Santos/ }));
}

describe('SystemAdminsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getSystemAdmins.mockResolvedValue({ data: [{
      school_id: 10101,
      first_name: 'Ana',
      last_name: 'Reyes',
      email: 'ana@example.test',
      organization_id: 8,
      account_status: 'active',
      position_title: 'Adviser',
      organization: { id: 8, name: 'Computing Council', acronym: 'CC' },
    }] });
    serviceMocks.getSystemOrganizations.mockResolvedValue({ data: [
      { id: 8, name: 'Computing Council', acronym: 'CC', is_active: true, lifecycle_status: 'active', administrators_count: 1 },
      { id: 9, name: 'Chess Club', acronym: 'CHESS', is_active: true, lifecycle_status: 'active', administrators_count: 0 },
      { id: 10, name: 'Drama Guild', acronym: 'DRAMA', is_active: false, lifecycle_status: 'pending', administrators_count: 0 },
    ] });
    profileMocks.getProfileOrganizations.mockResolvedValue({ data: [{ id: 8, name: 'Computing Council' }, { id: 9, name: 'Chess Club' }] });
    profileMocks.inviteAccountProfile.mockImplementation(async ({ organization_id }) => ({ data: { id: 1, organization_id } }));
    peopleMocks.searchPeople.mockResolvedValue([{ school_id: 20260001, name: 'Maria Santos', email: 'maria@example.test', program: 'BSIT', role: 'STUDENT', organizations: [] }]);
    serviceMocks.updateSystemAdmin.mockResolvedValue({});
    serviceMocks.initiateSystemAdminPasswordReset.mockResolvedValue({ message: 'Password reset instructions were sent.' });
  });

  it('adds an Admin by finding the person, with no school ID or password to type', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add administrator' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });

    expect(within(dialog).queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(dialog.querySelectorAll('input[type="password"]')).toHaveLength(0);

    await within(dialog).findByRole('option', { name: 'Computing Council' });
    fireEvent.change(within(dialog).getByLabelText(/^Organization/), { target: { value: '8' } });
    await pickMaria(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add administrator' }));

    await waitFor(() => expect(profileMocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 20260001, organization_id: 8, role: 'ADMIN' }));
    expect(await screen.findByText('Administrator added.')).toBeInTheDocument();
  });

  it('initiates a secure password reset after confirmation', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create reset link' }));

    await waitFor(() => expect(serviceMocks.initiateSystemAdminPasswordReset).toHaveBeenCalledWith(10101));
    expect(await screen.findByText('Password reset instructions were sent.')).toBeInTheDocument();
  });

  it('describes a one-time link and does not promise an email while mail is off', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset access' }));
    const dialog = screen.getByRole('dialog', { name: 'Initiate password reset' });
    expect(within(dialog).getByText(/one-time reset link/i)).toHaveTextContent(/shown to you once to hand over/i);
    expect(within(dialog).getByText(/one-time reset link/i)).toHaveTextContent(/emailed only when email is turned on/i);
    expect(within(dialog).queryByText(/will be sent/i)).not.toBeInTheDocument();
  });

  it('shows the one-time reset link with a copy button when mail is off', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    serviceMocks.initiateSystemAdminPasswordReset.mockResolvedValue({ message: 'The reset link is ready.', reset_link: 'https://hiusa.example.test/reset-password?token=abc' });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create reset link' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reset link ready' });
    expect(within(dialog).getByDisplayValue('https://hiusa.example.test/reset-password?token=abc')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://hiusa.example.test/reset-password?token=abc'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reset link ready' })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(/reset-password/)).not.toBeInTheDocument();
  });

  it('has one h1 from the shared header', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('loads every page of administrators and organizations, not just the first 100', async () => {
    const admin = (schoolId, firstName) => ({ school_id: schoolId, first_name: firstName, last_name: 'Reyes', email: `${firstName}@example.test`, organization_id: 8, account_status: 'active', position_title: 'Adviser', organization: { id: 8, name: 'Computing Council', acronym: 'CC' } });
    serviceMocks.getSystemAdmins.mockImplementation(async ({ page }) => ({ data: [page === 1 ? admin(1, 'Ana') : admin(2, 'Ben')], current_page: page, last_page: 2, per_page: 100, total: 2 }));
    serviceMocks.getSystemOrganizations.mockImplementation(async ({ page }) => ({ data: [page === 1 ? { id: 8, name: 'Computing Council', acronym: 'CC', is_active: true, lifecycle_status: 'active' } : { id: 12, name: 'Far Club', acronym: 'FAR', is_active: true, lifecycle_status: 'active' }], current_page: page, last_page: 2, per_page: 100, total: 2 }));
    renderPage();

    expect((await screen.findAllByText('Ben Reyes')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
    expect(serviceMocks.getSystemAdmins).toHaveBeenCalledWith(expect.objectContaining({ page: 2, per_page: 100 }));
    expect(serviceMocks.getSystemOrganizations).toHaveBeenCalledWith(expect.objectContaining({ page: 2, per_page: 100 }));
    expect(within(screen.getByLabelText('Filter by organization')).getByRole('option', { name: 'FAR: Far Club' })).toBeInTheDocument();
    expect(screen.getByText(/^2 administrators, 2 active/)).toBeInTheDocument();
  });

  it('labels the last column Actions because it holds a menu, and lists each admin as a card on phones', async () => {
    renderPage();
    const table = await screen.findByRole('table');

    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Administrator', 'Organization', 'Position', 'Status', 'Actions']);
    const cards = document.querySelector('[data-view="cards"]');
    expect(within(cards).getAllByRole('listitem')).toHaveLength(1);
    expect(within(cards).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: 'Actions for Ana Reyes' })).toBeInTheDocument();
  });

  it('shows Organization Admin as the position when none is set, and keeps a set one', async () => {
    serviceMocks.getSystemAdmins.mockResolvedValue({ data: [
      { school_id: 10101, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test', organization_id: 8, account_status: 'active', position_title: 'Adviser', organization: { id: 8, name: 'Computing Council', acronym: 'CC' } },
      { school_id: 20202, first_name: 'Ben', last_name: 'Cruz', email: 'ben@example.test', organization_id: 9, account_status: 'active', position_title: null, organization: { id: 9, name: 'Chess Club', acronym: 'CHESS' } },
    ] });
    renderPage();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    const benRow = rows.find((row) => within(row).queryByText('Ben Cruz'));
    const anaRow = rows.find((row) => within(row).queryByText('Ana Reyes'));
    expect(within(benRow).getByText('Organization Admin')).toBeInTheDocument();
    expect(within(anaRow).getByText('Adviser')).toBeInTheDocument();
    expect(within(anaRow).queryByText('Organization Admin')).not.toBeInTheDocument();
  });

  describe('admin profiles', () => {
    const profile = (overrides) => ({
      school_id: 10101, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test', organization_id: 8, account_status: 'active', position_title: 'Adviser',
      organization: { id: 8, name: 'Computing Council', acronym: 'CC' }, ...overrides,
    });
    const menuLabels = async (index = 0) => {
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[index]);
      return screen.getAllByRole('menuitem').map((item) => item.textContent);
    };

    it('renders the same school id on two profiles with distinct keys', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      serviceMocks.getSystemAdmins.mockResolvedValue({ data: [
        profile({ profile_id: 501, organization_id: 8 }),
        profile({ profile_id: 502, organization_id: 9, organization: { id: 9, name: 'Chess Club', acronym: 'CHESS' } }),
      ] });
      renderPage();

      const table = await screen.findByRole('table');
      expect(within(table).getAllByText('Ana Reyes')).toHaveLength(2);
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i);
      errors.mockRestore();
    });

    it('offers only Manage profiles for an account added through a profile', async () => {
      serviceMocks.getSystemAdmins.mockResolvedValue({ data: [profile({ profile_id: 502, is_primary_profile: false })] });
      renderPage();

      expect(await menuLabels()).toEqual(['Manage profiles']);
      expect(screen.getAllByText('Added through a profile').length).toBeGreaterThan(0);
    });

    it('treats a missing is_primary_profile flag as a primary profile', async () => {
      serviceMocks.getSystemAdmins.mockResolvedValue({ data: [profile({ profile_id: 501 })] });
      renderPage();

      expect(await menuLabels()).toEqual(['Add to organization', 'Manage profiles', 'Reset access', 'Edit administrator', 'Delete administrator']);
      expect(screen.queryByText('Added through a profile')).not.toBeInTheDocument();
    });

    it('keeps every action for an explicit primary profile', async () => {
      serviceMocks.getSystemAdmins.mockResolvedValue({ data: [profile({ profile_id: 501, is_primary_profile: true })] });
      renderPage();

      expect(await menuLabels()).toContain('Delete administrator');
    });
  });

  describe('provisioning from an approved registration', () => {
    const provisionLink = '/dashboard/super-admin/admins?organization=9&create=1';

    it('opens the add administrator dialog for the organization from the link', async () => {
      renderPage(provisionLink);

      const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
      expect(within(dialog).getByText('Chess Club')).toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/^Organization/)).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('create=1'));
      expect(screen.getByTestId('location')).not.toHaveTextContent('organization=');
    });

    it('shows the registration stepper and a Add Admin account step when the form is cancelled', async () => {
      renderPage(provisionLink);
      const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      const stepper = await screen.findByRole('list', { name: 'Registration progress for Chess Club' });
      expect(within(stepper).getByText('Admin account').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(screen.getByText('Add the first Admin account')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Add Admin account' }));
      const reopened = await screen.findByRole('dialog', { name: 'Add administrator' });
      expect(within(reopened).getByText('Chess Club')).toBeInTheDocument();
    });

    it('adds the administrator for the linked organization and then says the administrator can sign in', async () => {
      renderPage(provisionLink);
      const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
      await pickMaria(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add administrator' }));

      await waitFor(() => expect(profileMocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 20260001, organization_id: 9, role: 'ADMIN' }));
      expect(await screen.findByText('Done: Maria Santos can sign in')).toBeInTheDocument();
      expect(screen.getByText('Chess Club now has an administrator.')).toBeInTheDocument();
      const stepper = screen.getByRole('list', { name: 'Registration progress for Chess Club' });
      expect(within(stepper).getAllByText(/^Done:/)).toHaveLength(4);
      expect(within(stepper).queryByText(/Current step/)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open organization' })).toHaveAttribute('href', '/dashboard/super-admin/org/9');
    });

    it('also reports completion when the administrator is added with the plain button', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Add administrator' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
      await within(dialog).findByRole('option', { name: 'Chess Club' });
      fireEvent.change(within(dialog).getByLabelText(/^Organization/), { target: { value: '9' } });
      await pickMaria(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add administrator' }));

      expect(await screen.findByText('Done: Maria Santos can sign in')).toBeInTheDocument();
    });

    it('refuses to open the form for an organization that is not active yet', async () => {
      renderPage('/dashboard/super-admin/admins?organization=10&create=1');

      expect(await screen.findByText('Drama Guild is not active yet. Approve its registration before assigning an administrator.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Add administrator' })).not.toBeInTheDocument();
    });

    it('loads an organization that is not on the first page of the list', async () => {
      serviceMocks.getSystemOrganizationOverview.mockResolvedValue({
        organization: { id: 77, name: 'Far Club', acronym: 'FAR', is_active: true, lifecycle_status: 'active' },
        lifecycle: { status: 'active' },
        member_counts: { ADMIN: 0 },
      });
      renderPage('/dashboard/super-admin/admins?organization=77&create=1');

      const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
      expect(within(dialog).getByText('Far Club')).toBeInTheDocument();
      expect(serviceMocks.getSystemOrganizationOverview).toHaveBeenCalledWith('77');
    });

    it('filters the list to the organization when only ?organization is given', async () => {
      renderPage('/dashboard/super-admin/admins?organization=9');

      await waitFor(() => expect(screen.getByLabelText('Filter by organization')).toHaveValue('9'));
      expect(screen.queryByRole('dialog', { name: 'Add administrator' })).not.toBeInTheDocument();
    });
  });

  describe('silent refresh while the tab stays open', () => {
    const admin = (overrides) => ({ school_id: 10101, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test', organization_id: 8, account_status: 'active', position_title: 'Adviser', organization: { id: 8, name: 'Computing Council', acronym: 'CC' }, ...overrides });

    it('updates the rows through the same paged loader without a loading state, and keeps the search text and the open form', async () => {
      renderPage();
      await screen.findAllByText('Ana Reyes');
      fireEvent.change(screen.getByLabelText('Search administrators'), { target: { value: 'Reyes' } });
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit administrator' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit administrator' });
      fireEvent.change(within(dialog).getByLabelText(/First name/i), { target: { value: 'Anita' } });

      let release;
      serviceMocks.getSystemAdmins.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      expect(document.querySelector('.animate-pulse')).toBeNull();
      expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);

      await act(async () => {
        release({ data: [admin({ position_title: 'President' }), admin({ school_id: 20202, first_name: 'Ben', email: 'ben@example.test' })], current_page: 1, last_page: 1, per_page: 100, total: 2 });
        await refresh;
      });

      expect(screen.getAllByText('President').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Ben Reyes').length).toBeGreaterThan(0);
      expect(document.querySelector('.animate-pulse')).toBeNull();
      expect(screen.getByLabelText('Search administrators')).toHaveValue('Reyes');
      expect(screen.getByRole('dialog', { name: 'Edit administrator' })).toBeInTheDocument();
      expect(within(screen.getByRole('dialog', { name: 'Edit administrator' })).getByLabelText(/First name/i)).toHaveValue('Anita');
      expect(screen.getByText(/^2 administrators, 2 active/)).toBeInTheDocument();
    });

    it('shows the organization as plain text and never sends an organization change when editing', async () => {
      renderPage();
      await screen.findAllByText('Ana Reyes');
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit administrator' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit administrator' });

      expect(within(dialog).queryByRole('combobox', { name: /Assigned organization/ })).not.toBeInTheDocument();
      expect(within(dialog).getByText(/^CC: Computing Council/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(serviceMocks.updateSystemAdmin).toHaveBeenCalledWith(10101, expect.objectContaining({ first_name: 'Ana' })));
      expect(serviceMocks.updateSystemAdmin.mock.calls[0][1]).not.toHaveProperty('organization_id');
    });

    it('says Active in the Status column instead of leaving it blank', async () => {
      renderPage();
      await screen.findAllByText('Ana Reyes');

      expect(within(document.querySelector('table')).getAllByText('Active').length).toBeGreaterThan(0);
    });

    it('walks every page when it refreshes silently', async () => {
      renderPage();
      await screen.findAllByText('Ana Reyes');
      serviceMocks.getSystemAdmins.mockImplementation(async ({ page }) => ({ data: [page === 1 ? admin() : admin({ school_id: 30303, first_name: 'Cara' })], current_page: page, last_page: 2, per_page: 100, total: 2 }));

      await act(async () => { await refetchHook.current(); });

      expect(serviceMocks.getSystemAdmins).toHaveBeenCalledWith(expect.objectContaining({ page: 2, per_page: 100 }));
      expect(screen.getAllByText('Cara Reyes').length).toBeGreaterThan(0);
    });

    it('keeps the rows and shows no error when the silent refresh fails', async () => {
      renderPage();
      await screen.findAllByText('Ana Reyes');

      serviceMocks.getSystemAdmins.mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await refetchHook.current(); });

      expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
      expect(screen.queryByText('Unable to load SAO administrator accounts.')).not.toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).toBeNull();
    });

    it('does not clear an error the user is looking at when a silent refresh succeeds', async () => {
      serviceMocks.initiateSystemAdminPasswordReset.mockRejectedValueOnce(new Error('mail down'));
      renderPage();
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reset access' }));
      fireEvent.click(screen.getByRole('button', { name: 'Create reset link' }));
      expect(await screen.findByText('Could not initiate the password reset.')).toBeInTheDocument();

      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('Could not initiate the password reset.')).toBeInTheDocument();
    });

    it('drops a silent response that arrives after a newer full load', async () => {
      renderPage();
      await screen.findAllByText('Ana Reyes');

      let releaseSilent;
      serviceMocks.getSystemAdmins.mockReturnValueOnce(new Promise((resolve) => { releaseSilent = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });

      serviceMocks.getSystemAdmins.mockResolvedValue({ data: [admin({ position_title: 'Treasurer' })] });
      serviceMocks.deleteSystemAdmin.mockResolvedValue({});
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Reyes' }))[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete administrator' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete administrator' }));
      expect((await screen.findAllByText('Treasurer')).length).toBeGreaterThan(0);

      await act(async () => {
        releaseSilent({ data: [admin({ position_title: 'Stale' })] });
        await refresh;
      });

      expect(screen.queryByText('Stale')).not.toBeInTheDocument();
      expect(screen.getAllByText('Treasurer').length).toBeGreaterThan(0);
    });
  });
});
