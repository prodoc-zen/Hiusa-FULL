import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemAdminsPage from './SystemAdminsPage';

const serviceMocks = vi.hoisted(() => ({
  getSystemAdmins: vi.fn(),
  getSystemOrganizations: vi.fn(),
  getSystemOrganizationOverview: vi.fn(),
  createSystemAdmin: vi.fn(),
  updateSystemAdmin: vi.fn(),
  initiateSystemAdminPasswordReset: vi.fn(),
}));

vi.mock('../../../services/systemAdministrationService', () => serviceMocks);

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

const renderPage = (entry = '/dashboard/super-admin/admins') => render(<MemoryRouter initialEntries={[entry]}><SystemAdminsPage /><Probe /></MemoryRouter>);

async function fillAdminForm({ organization } = {}) {
  fireEvent.change(await screen.findByLabelText(/School ID/i), { target: { value: '20260001' } });
  fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: 'Maria' } });
  fireEvent.change(screen.getByLabelText(/Last name/i), { target: { value: 'Santos' } });
  fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'MARIA@example.test' } });
  if (organization) fireEvent.change(screen.getByLabelText(/Assigned organization/i), { target: { value: organization } });
  fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'Initial-Password-123!' } });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: 'Initial-Password-123!' } });
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
    serviceMocks.createSystemAdmin.mockResolvedValue({});
    serviceMocks.updateSystemAdmin.mockResolvedValue({});
    serviceMocks.initiateSystemAdminPasswordReset.mockResolvedValue({ message: 'Password reset instructions were sent.' });
  });

  it('requires and submits the initial password when SAO creates an Admin', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New Admin User' }));

    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(screen.getByText(/SAO sets the initial password/i)).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Adviser"]')).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Organization Adviser"]')).not.toBeInTheDocument();

    await fillAdminForm({ organization: '8' });
    fireEvent.click(screen.getByRole('button', { name: 'Create Admin User' }));

    await waitFor(() => expect(serviceMocks.createSystemAdmin).toHaveBeenCalledWith(expect.objectContaining({
      school_id: 20260001,
      organization_id: 8,
      email: 'maria@example.test',
      password: 'Initial-Password-123!',
      password_confirmation: 'Initial-Password-123!',
    })));
  });

  it('initiates a secure password reset after confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Ana Reyes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(serviceMocks.initiateSystemAdminPasswordReset).toHaveBeenCalledWith(10101));
    expect(await screen.findByText('Password reset instructions were sent.')).toBeInTheDocument();
  });

  it('has one h1 from the shared header', async () => {
    renderPage();
    await screen.findByText('Ana Reyes');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  describe('provisioning from an approved registration', () => {
    const provisionLink = '/dashboard/super-admin/admins?organization=9&create=1';

    it('opens the create form with the organization preselected and locked', async () => {
      renderPage(provisionLink);

      const dialog = await screen.findByRole('dialog', { name: 'Create administrator' });
      const select = within(dialog).getByLabelText(/Assigned organization/i);
      expect(select).toHaveValue('9');
      expect(select).toBeDisabled();
      expect(within(dialog).getByText('Locked to the organization you are provisioning.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('create=1'));
      expect(screen.getByTestId('location')).not.toHaveTextContent('organization=');
    });

    it('shows the registration stepper and a Provision administrator step when the form is cancelled', async () => {
      renderPage(provisionLink);
      const dialog = await screen.findByRole('dialog', { name: 'Create administrator' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      const stepper = await screen.findByRole('list', { name: 'Registration progress for Chess Club' });
      expect(within(stepper).getByText('Administrator').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(screen.getByText('Provision an administrator')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Provision administrator' }));
      const reopened = await screen.findByRole('dialog', { name: 'Create administrator' });
      expect(within(reopened).getByLabelText(/Assigned organization/i)).toHaveValue('9');
      expect(within(reopened).getByLabelText(/Assigned organization/i)).toBeDisabled();
    });

    it('creates the administrator for the locked organization and then says the administrator can sign in', async () => {
      renderPage(provisionLink);
      const dialog = await screen.findByRole('dialog', { name: 'Create administrator' });
      await fillAdminForm();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Admin User' }));

      await waitFor(() => expect(serviceMocks.createSystemAdmin).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 9, school_id: 20260001 })));
      expect(await screen.findByText('Done: Maria Santos can sign in')).toBeInTheDocument();
      expect(screen.getByText('Chess Club now has an administrator.')).toBeInTheDocument();
      const stepper = screen.getByRole('list', { name: 'Registration progress for Chess Club' });
      expect(within(stepper).getAllByText(/^Done:/)).toHaveLength(4);
      expect(within(stepper).queryByText(/Current step/)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open organization' })).toHaveAttribute('href', '/dashboard/super-admin/organizations/9');
    });

    it('also reports completion when the administrator is created with the plain button', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'New Admin User' }));
      await fillAdminForm({ organization: '9' });
      fireEvent.click(screen.getByRole('button', { name: 'Create Admin User' }));

      expect(await screen.findByText('Done: Maria Santos can sign in')).toBeInTheDocument();
    });

    it('refuses to open the form for an organization that is not active yet', async () => {
      renderPage('/dashboard/super-admin/admins?organization=10&create=1');

      expect(await screen.findByText('Drama Guild is not active yet. Approve its registration before assigning an administrator.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Create administrator' })).not.toBeInTheDocument();
    });

    it('loads an organization that is not on the first page of the list', async () => {
      serviceMocks.getSystemOrganizationOverview.mockResolvedValue({
        organization: { id: 77, name: 'Far Club', acronym: 'FAR', is_active: true, lifecycle_status: 'active' },
        lifecycle: { status: 'active' },
        member_counts: { ADMIN: 0 },
      });
      renderPage('/dashboard/super-admin/admins?organization=77&create=1');

      const dialog = await screen.findByRole('dialog', { name: 'Create administrator' });
      expect(within(dialog).getByLabelText(/Assigned organization/i)).toHaveValue('77');
      expect(serviceMocks.getSystemOrganizationOverview).toHaveBeenCalledWith('77');
    });

    it('filters the list to the organization when only ?organization is given', async () => {
      renderPage('/dashboard/super-admin/admins?organization=9');

      await waitFor(() => expect(screen.getByLabelText('Filter by organization')).toHaveValue('9'));
      expect(screen.queryByRole('dialog', { name: 'Create administrator' })).not.toBeInTheDocument();
    });
  });
});
