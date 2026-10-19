import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoUsersPage from './SaoUsersPage';

const service = vi.hoisted(() => ({ getSystemUsers: vi.fn(), getSystemUser: vi.fn(), deleteSystemUser: vi.fn(), createSystemAdmin: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => service);
const profile = vi.hoisted(() => ({ getProfileOrganizations: vi.fn(), getProfileCandidates: vi.fn(), inviteAccountProfile: vi.fn() }));
vi.mock('../../../services/authService', () => profile);

const user = { school_id: 20261234, first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.test', role: 'STUDENT', account_status: 'active', organization: { id: 7, name: 'Computing Society' } };
const page = (rows) => ({ data: rows, current_page: 1, last_page: 1, per_page: 20, total: rows.length });

describe('SAO university users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSystemUsers.mockResolvedValue(page([user]));
    service.getSystemUser.mockResolvedValue({ user: { ...user, profiles: [{ id: 1, role: 'STUDENT', organization: user.organization }] }, clearances: [{ period_id: 3, title: 'First Semester', academic_year: '2026-2027', is_complete: false, signatures: [{ required_role: 'sao', status: 'held' }] }], linked_records: { profiles: 1 } });
    service.deleteSystemUser.mockResolvedValue({ message: 'Deleted.' });
    service.createSystemAdmin.mockResolvedValue({ school_id: 78123456, role: 'ADMIN' });
    profile.getProfileOrganizations.mockResolvedValue({ data: [{ id: 8, name: 'Robotics Club', college: 'College of Computing' }] });
    profile.getProfileCandidates.mockResolvedValue({ data: page([user]) });
    profile.inviteAccountProfile.mockResolvedValue({ data: { role: 'ADMIN' } });
  });

  it('creates an administrator directly from University users and refreshes the list', async () => {
    render(<SaoUsersPage />);
    await screen.findByText('Ana Cruz');
    fireEvent.click(screen.getByRole('button', { name: 'Add administrator' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
    await within(dialog).findByRole('option', { name: 'Robotics Club' });
    fireEvent.change(within(dialog).getByLabelText(/^Organization/), { target: { value: '8' } });
    for (const [label, value] of [['School ID', '78123456'], ['First name', 'New'], ['Last name', 'Admin'], ['Email', 'new@example.test'], ['Initial password', 'Initial-Password-123!'], ['Confirm initial password', 'Initial-Password-123!']]) {
      fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    }
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Create administrator' }).form);
    await waitFor(() => expect(service.createSystemAdmin).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 8, school_id: 78123456 })));
    expect(await screen.findByText('Administrator account created.')).toBeInTheDocument();
    expect(service.getSystemUsers.mock.calls.length).toBeGreaterThan(1);
  });

  it('adds an Admin profile to an existing university login from its action menu', async () => {
    render(<SaoUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Ana Cruz' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Admin profile' }));
    await screen.findByRole('option', { name: 'Robotics Club' });
    fireEvent.change(screen.getByLabelText('Destination organization'), { target: { value: '8' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Ana Cruz/ }));
    expect(screen.getByLabelText('Role in destination organization')).toHaveValue('ADMIN');
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(profile.inviteAccountProfile).toHaveBeenCalledWith({ school_id: user.school_id, organization_id: 8, role: 'ADMIN' }));
    expect(await screen.findByText('Admin profile added to the existing university login.')).toBeInTheDocument();
  });

  it('searches across accounts and shows profiles and clearance in a drawer', async () => {
    render(<SaoUsersPage />);
    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'STUDENT' } });
    await waitFor(() => expect(service.getSystemUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'STUDENT' })));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Ana Cruz' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View user and clearance' }));
    const drawer = await screen.findByRole('dialog', { name: 'Ana Cruz' });
    expect(within(drawer).getByText('First Semester')).toBeInTheDocument();
    expect(within(drawer).getByText('sao: held')).toBeInTheDocument();
    expect(service.getSystemUser).toHaveBeenCalledWith(user.school_id);
  });

  it('requires the exact School ID before deleting an account', async () => {
    render(<SaoUsersPage />);
    await screen.findByText('Ana Cruz');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Ana Cruz' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete user and linked records?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete user' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type 20261234 to confirm/), { target: { value: '20261234' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(service.deleteSystemUser).toHaveBeenCalledWith(user.school_id));
  });
});
