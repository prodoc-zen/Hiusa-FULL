import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemOrganizationsPage from './SystemOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getSystemOrganizations: vi.fn(), getSystemColleges: vi.fn(), createSystemOrganization: vi.fn(), updateSystemOrganization: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);
const profileMocks = vi.hoisted(() => ({ getProfileCandidates: vi.fn(), inviteAccountProfile: vi.fn() }));
vi.mock('../../../services/authService', () => profileMocks);

describe('SystemOrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 1, name: 'College of Arts', is_active: true }]);
    mocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 3, name: 'Main SBO', acronym: 'SBO', college: 'College of Arts', is_active: true, users_count: 0, administrators: [] }], current_page: 1, last_page: 1 });
    profileMocks.getProfileCandidates.mockResolvedValue({ data: { data: [{ school_id: 123, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test' }], current_page: 1, last_page: 1, total: 1 } });
    profileMocks.inviteAccountProfile.mockResolvedValue({ data: { id: 9, organization_id: 3 } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveValue('Changed name');
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
