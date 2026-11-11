import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoUsersPage from './SaoUsersPage';

const service = vi.hoisted(() => ({ getSystemUsers: vi.fn(), getSystemUser: vi.fn(), deleteSystemUser: vi.fn(), resetSystemUserPassword: vi.fn(), createSystemAdmin: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => service);
const profile = vi.hoisted(() => ({ getProfileOrganizations: vi.fn(), getProfileCandidates: vi.fn(), inviteAccountProfile: vi.fn() }));
vi.mock('../../../services/authService', () => profile);
const people = vi.hoisted(() => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/peopleService', () => people);

const user = { school_id: 20261234, first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.test', role: 'STUDENT', account_status: 'active', organization: { id: 7, name: 'Computing Society' } };
const page = (rows) => ({ data: rows, current_page: 1, last_page: 1, per_page: 20, total: rows.length });

describe('SAO university users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSystemUsers.mockResolvedValue(page([user]));
    service.getSystemUser.mockResolvedValue({ user: { ...user, profiles: [{ id: 1, role: 'STUDENT', organization: user.organization }] }, clearances: [{ period_id: 3, title: 'First Semester', academic_year: '2026-2027', is_complete: false, signatures: [{ required_role: 'sao', status: 'held' }] }], linked_records: { profiles: 1 } });
    service.deleteSystemUser.mockResolvedValue({ message: 'Deleted.' });
    service.resetSystemUserPassword.mockResolvedValue({ message: 'The reset link is ready.', reset_link: 'https://hiusa.example.test/reset-password?token=abc' });
    service.createSystemAdmin.mockResolvedValue({ school_id: 78123456, role: 'ADMIN' });
    profile.getProfileOrganizations.mockResolvedValue({ data: [{ id: 8, name: 'Robotics Club', college: 'College of Computing' }] });
    profile.getProfileCandidates.mockResolvedValue({ data: page([user]) });
    profile.inviteAccountProfile.mockResolvedValue({ data: { role: 'ADMIN' } });
    people.searchPeople.mockResolvedValue([{ school_id: 78123456, name: 'New Admin', email: 'new@example.test', program: 'BSIT', role: 'STUDENT', organizations: [] }]);
  });

  it('shows no Status column and marks only an account that is not active beside the name', async () => {
    service.getSystemUsers.mockResolvedValue(page([user, { ...user, school_id: 20265678, first_name: 'Ben', email: 'ben@example.test', account_status: 'disabled' }]));
    render(<SaoUsersPage />);
    await screen.findAllByText('Ana Cruz');
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    const [ben] = screen.getAllByRole('row').filter((row) => within(row).queryByText('Ben Cruz'));
    expect(within(ben).getByText('Disabled')).toBeInTheDocument();
    const [ana] = screen.getAllByRole('row').filter((row) => within(row).queryByText('Ana Cruz'));
    expect(within(ana).queryByText(/^(Active|Disabled|Inactive)$/)).not.toBeInTheDocument();
  });

  it('keeps the user action menu open when the initial search debounce completes', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => { render(<SaoUsersPage />); });
      fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Ana Cruz' })[0]);
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(service.getSystemUsers).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('menuitem', { name: 'Add admin profile' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('adds an administrator by finding the person, without typing a school ID or a password', async () => {
    render(<SaoUsersPage />);
    await screen.findAllByText('Ana Cruz');
    fireEvent.click(screen.getByRole('button', { name: 'Add administrator' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
    expect(within(dialog).queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    await within(dialog).findByRole('option', { name: 'Robotics Club' });
    fireEvent.change(within(dialog).getByLabelText(/^Organization/), { target: { value: '8' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Student' }), { target: { value: 'new adm' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /New Admin/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add administrator' }));
    await waitFor(() => expect(profile.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 78123456, organization_id: 8, role: 'ADMIN' }));
    expect(await screen.findByText('Administrator added.')).toBeInTheDocument();
    expect(service.getSystemUsers.mock.calls.length).toBeGreaterThan(1);
  });

  it('adds an Admin profile to an existing university login from its action menu', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add admin profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add administrator' });
    await within(dialog).findByRole('option', { name: 'Robotics Club' });
    fireEvent.change(within(dialog).getByLabelText(/^Organization/), { target: { value: '8' } });
    expect(within(dialog).getByText('Ana Cruz')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Role in this organization')).toHaveValue('ADMIN');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add administrator' }));
    await waitFor(() => expect(profile.inviteAccountProfile).toHaveBeenCalledWith({ school_id: user.school_id, organization_id: 8, role: 'ADMIN' }));
    expect(await screen.findByText('Administrator added.')).toBeInTheDocument();
  });

  it('searches across accounts and shows profiles and clearance in a drawer', async () => {
    render(<SaoUsersPage />);
    expect((await screen.findAllByText('Ana Cruz'))[0]).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'STUDENT' } });
    await waitFor(() => expect(service.getSystemUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'STUDENT' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Ana Cruz' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View user and clearance' }));
    const drawer = await screen.findByRole('dialog', { name: 'Ana Cruz' });
    expect(within(drawer).getByText('First Semester')).toBeInTheDocument();
    expect(within(drawer).getByText('sao: held')).toBeInTheDocument();
    expect(service.getSystemUser).toHaveBeenCalledWith(user.school_id);
  });

  it('requires the exact School ID before deleting an account', async () => {
    render(<SaoUsersPage />);
    await screen.findAllByText('Ana Cruz');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Ana Cruz' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete user and linked records?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete user' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type Ana Cruz to confirm/), { target: { value: 'Ana Cruz' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(service.deleteSystemUser).toHaveBeenCalledWith(user.school_id));
  });
  it('hands the SAO a one-time reset link for an active student', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    const confirm = screen.getByRole('dialog', { name: 'Reset password' });
    expect(service.resetSystemUserPassword).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(service.resetSystemUserPassword).toHaveBeenCalledWith(user.school_id));
    const link = await screen.findByRole('dialog', { name: 'Reset link ready' });
    expect(within(link).getByDisplayValue('https://hiusa.example.test/reset-password?token=abc')).toBeInTheDocument();
    fireEvent.click(within(link).getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(/reset-password/)).not.toBeInTheDocument();
    expect(screen.getByText('Reset link created for Ana Cruz.')).toBeInTheDocument();
  });

  it('shows the confirmation message instead of a link when the reset was emailed', async () => {
    service.resetSystemUserPassword.mockResolvedValue({ message: 'Password reset instructions were sent to the member email address.' });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset password' })).getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Password reset instructions were sent to the member email address.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Reset link ready' })).not.toBeInTheDocument();
  });

  it('keeps the reset dialog open and says why when the reset fails', async () => {
    service.resetSystemUserPassword.mockRejectedValue({ response: { data: { message: 'Activate this account before initiating a password reset.' } } });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    const confirm = screen.getByRole('dialog', { name: 'Reset password' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Send reset link' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Activate this account before initiating a password reset.');
    expect(screen.queryByRole('dialog', { name: 'Reset link ready' })).not.toBeInTheDocument();
  });

  it('offers a password reset only for active students and officers', async () => {
    service.getSystemUsers.mockResolvedValue(page([
      { ...user, school_id: 1, first_name: 'Ben', role: 'SBO_OFFICER' },
      { ...user, school_id: 2, first_name: 'Cara', account_status: 'inactive' },
      { ...user, school_id: 3, first_name: 'Dan', role: 'ADMIN' },
      { ...user, school_id: 4, first_name: 'Eve', role: 'SUPER_ADMIN' },
    ]));
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ben Cruz' }))[0]);
    expect(screen.getByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    for (const name of ['Cara', 'Dan', 'Eve']) {
      fireEvent.click(screen.getAllByRole('button', { name: `Actions for ${name} Cruz` })[0]);
      expect(screen.queryByRole('menuitem', { name: 'Reset password' })).not.toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('shows the answer to the latest filter even when an earlier request lands last', async () => {
    let releaseFirst;
    service.getSystemUsers.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(page([user])); }));
    service.getSystemUsers.mockResolvedValue(page([]));

    render(<SaoUsersPage />);
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ADMIN' } });
    await waitFor(() => expect(service.getSystemUsers).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    await act(async () => { releaseFirst(); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument();
  });
});
