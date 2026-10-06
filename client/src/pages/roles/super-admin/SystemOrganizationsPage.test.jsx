import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemOrganizationsPage from './SystemOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getSystemOrganizations: vi.fn(), getSystemColleges: vi.fn(), createSystemOrganization: vi.fn(), updateSystemOrganization: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);
const profileMocks = vi.hoisted(() => ({ getProfileCandidates: vi.fn(), inviteAccountProfile: vi.fn(), getManagedAccountProfiles: vi.fn(), deleteAccountProfile: vi.fn() }));
vi.mock('../../../services/authService', () => profileMocks);

describe('SystemOrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 1, name: 'College of Arts', is_active: true }]);
    mocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 3, name: 'Main SBO', acronym: 'SBO', college: 'College of Arts', is_active: true, users_count: 0, administrators: [] }], current_page: 1, last_page: 1 });
    profileMocks.getProfileCandidates.mockResolvedValue({ data: { data: [{ school_id: 123, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test' }], current_page: 1, last_page: 1, total: 1 } });
    profileMocks.inviteAccountProfile.mockResolvedValue({ data: { id: 9, organization_id: 3 } });
    profileMocks.getManagedAccountProfiles.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0 } });
  });

  it('opens searchable membership from the organization action menu', async () => {
    render(<SystemOrganizationsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add existing user' }));
    expect(screen.getByRole('dialog', { name: 'Add existing user' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('radio', { name: /Ana Reyes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(profileMocks.inviteAccountProfile).toHaveBeenCalledWith({ organization_id: 3, school_id: 123, role: 'STUDENT' }));
    expect(await screen.findByRole('status')).toHaveTextContent('User added to the organization.');
  });

  it('adds users from the organization editor and preserves unsaved edits when returning', async () => {
    render(<SystemOrganizationsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit organization' }));
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Changed name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add existing user' }));
    expect(screen.queryByRole('dialog', { name: 'Edit organization' })).not.toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: /Ana Reyes/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Admin', exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveValue('Changed name');
  });

  it('adds an Admin to a suborganization from its action menu and displays its profile count', async () => {
    mocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 4, name: 'Arts Club', acronym: 'AC', college: 'College of Arts', parent_organization_id: 3, is_active: true, users_count: 1, administrators_count: 1, administrators: [] }], current_page: 1, last_page: 1 });
    render(<SystemOrganizationsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Arts Club' }));
    expect(screen.getByText(/1 members.*1 admins/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add existing user' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Ana Reyes/ }));
    fireEvent.change(screen.getByLabelText('Role in destination organization'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(profileMocks.inviteAccountProfile).toHaveBeenCalledWith({ organization_id: 4, school_id: 123, role: 'ADMIN' }));
  });

  it('opens profile management from the editor and preserves unsaved changes', async () => {
    render(<SystemOrganizationsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Main SBO' }));
    expect(screen.getByRole('menuitem', { name: 'Manage user profiles' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit organization' }));
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Unsaved change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Manage user profiles' }));
    expect(screen.queryByRole('dialog', { name: 'Edit organization' })).not.toBeInTheDocument();
    expect(await screen.findByText('No profiles found in the organizations you manage.')).toBeInTheDocument();
    expect(profileMocks.getManagedAccountProfiles).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(screen.getByLabelText('Organization name')).toHaveValue('Unsaved change');
  });

  it('offers catalog colleges when adding an organization', async () => {
    mocks.createSystemOrganization.mockResolvedValue({ id: 4 });
    render(<SystemOrganizationsPage />);
    await screen.findByText('Main SBO');
    fireEvent.click(screen.getByRole('button', { name: 'Add organization' }));
    const dialog = screen.getByRole('dialog', { name: 'Add organization' });
    expect(within(dialog).getByRole('option', { name: 'College of Arts' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Organization name'), { target: { value: 'New Club' } });
    fireEvent.change(within(dialog).getByLabelText('Organization code'), { target: { value: 'NC' } });
    fireEvent.change(within(dialog).getByLabelText('Department / college'), { target: { value: 'College of Arts' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save organization' }));
    await waitFor(() => expect(mocks.createSystemOrganization).toHaveBeenCalledWith(expect.objectContaining({ college: 'College of Arts' })));
  });
});
