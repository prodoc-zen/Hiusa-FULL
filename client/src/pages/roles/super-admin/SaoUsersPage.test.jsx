import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoUsersPage from './SaoUsersPage';

const service = vi.hoisted(() => ({ getSystemUsers: vi.fn(), getSystemUser: vi.fn(), deleteSystemUser: vi.fn(), resetSystemUserPassword: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => service);

const user = { school_id: 20261234, first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.test', role: 'STUDENT', account_status: 'active', organization: { id: 7, name: 'Computing Society' } };
const page = (rows) => ({ data: rows, current_page: 1, last_page: 1, per_page: 20, total: rows.length });

describe('SAO university users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSystemUsers.mockResolvedValue(page([user]));
    service.getSystemUser.mockResolvedValue({ user: { ...user, profiles: [{ id: 1, role: 'STUDENT', organization: user.organization }] }, clearances: [{ period_id: 3, title: 'First Semester', academic_year: '2026-2027', is_complete: false, signatures: [{ required_role: 'sao', status: 'held' }] }], linked_records: { events: { label: 'events created', count: 0 } } });
    service.deleteSystemUser.mockResolvedValue({ message: 'Deleted.' });
    service.resetSystemUserPassword.mockResolvedValue({ message: 'The reset link is ready.', reset_link: 'https://hiusa.example.test/reset-password?token=abc' });
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
      expect(screen.getByRole('menuitem', { name: 'Delete user' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('does not let the SAO add an administrator or an admin profile, since the Department Head names organization heads', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    expect(screen.queryByRole('menuitem', { name: 'Add admin profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add administrator' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'View user and clearance' })).toBeInTheDocument();
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
    const dialog = screen.getByRole('dialog', { name: 'Delete user?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete user' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type Ana Cruz to confirm/), { target: { value: 'Ana Cruz' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(service.deleteSystemUser).toHaveBeenCalledWith(user.school_id));
  });
  it('names the linked records that block a delete with the plain label the server sends', async () => {
    service.deleteSystemUser.mockRejectedValue({ response: { status: 409, data: { message: 'This user has linked records such as finance entries. Deactivate the account instead.', linked_records: {
      votes: { label: 'votes cast', count: 12 }, orders: { label: 'orders placed', count: 3 }, cash_advances: { label: 'cash advances borrowed', count: 1 },
    } } } });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete user?' });
    fireEvent.change(within(dialog).getByLabelText(/Type Ana Cruz to confirm/), { target: { value: 'Ana Cruz' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
    const refusal = await within(dialog).findByRole('alert');
    expect(refusal).toHaveTextContent('votes cast: 12, orders placed: 3, cash advances borrowed: 1');
    expect(refusal).toHaveTextContent('Deactivate the account instead');
  });

  it('shows the audit log reference as activity log entries and leaves zero counts out of the refusal', async () => {
    service.deleteSystemUser.mockRejectedValue({ response: { status: 409, data: { message: 'This user has linked records.', linked_records: {
      audit_logs_user_id: { label: 'activity log entries', count: 1 }, votes: { label: 'votes cast', count: 0 }, events: { label: 'events created', count: 0 },
    } } } });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete user?' });
    fireEvent.change(within(dialog).getByLabelText(/Type Ana Cruz to confirm/), { target: { value: 'Ana Cruz' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
    const refusal = await within(dialog).findByRole('alert');
    expect(refusal).toHaveTextContent('activity log entries: 1');
    expect(refusal).not.toHaveTextContent(/audit logs user id|audit_logs/i);
    expect(refusal).not.toHaveTextContent('votes cast');
    expect(refusal).not.toHaveTextContent('events created');
  });

  it('says only the account and its profiles are removed, and that an account with history is deactivated instead', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete user?' });
    expect(within(dialog).getByText(/Only the account and its profiles are removed/)).toHaveTextContent(/cannot be deleted and should be deactivated instead/);
    expect(within(dialog).queryByText(/permanently removes/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/linked submissions/i)).not.toBeInTheDocument();
  });

  it('lists only the linked records that exist in the drawer, under the labels the server sends', async () => {
    service.getSystemUser.mockResolvedValue({ user: { ...user, profiles: [{ id: 1, role: 'STUDENT', organization: user.organization }] }, clearances: [], linked_records: {
      audit_logs_user_id: { label: 'activity log entries', count: 4 }, votes: { label: 'votes cast', count: 0 }, events: { label: 'events created', count: 2 },
    } });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View user and clearance' }));
    const drawer = await screen.findByRole('dialog', { name: 'Ana Cruz' });
    const section = (await within(drawer).findByRole('heading', { name: 'Linked records' })).closest('section');
    expect(within(section).getByText('activity log entries')).toBeInTheDocument();
    expect(within(section).getByText('events created')).toBeInTheDocument();
    expect(within(section).getByText('4')).toBeInTheDocument();
    expect(within(section).getByText('2')).toBeInTheDocument();
    expect(within(section).queryByText('votes cast')).not.toBeInTheDocument();
    expect(within(section).queryByText(/audit logs user id/i)).not.toBeInTheDocument();
    expect(within(section).queryByText(/no linked records/i)).not.toBeInTheDocument();
  });

  it('says plainly that an account with no linked records can be deleted', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View user and clearance' }));
    const drawer = await screen.findByRole('dialog', { name: 'Ana Cruz' });
    const section = (await within(drawer).findByRole('heading', { name: 'Linked records' })).closest('section');
    expect(within(section).getByText('No linked records. This account can be deleted.')).toBeInTheDocument();
    expect(within(section).queryByText('events created')).not.toBeInTheDocument();
    expect(within(section).queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps the server message when a delete refusal carries no counts', async () => {
    service.deleteSystemUser.mockRejectedValue({ response: { status: 409, data: { message: 'The last active SAO account cannot be deleted.' } } });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete user?' });
    fireEvent.change(within(dialog).getByLabelText(/Type Ana Cruz to confirm/), { target: { value: 'Ana Cruz' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The last active SAO account cannot be deleted.');
  });

  it('hands the SAO a one-time reset link for an active student', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    const confirm = screen.getByRole('dialog', { name: 'Create reset link' });
    expect(service.resetSystemUserPassword).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Create reset link' }));
    await waitFor(() => expect(service.resetSystemUserPassword).toHaveBeenCalledWith(user.school_id));
    const link = await screen.findByRole('dialog', { name: 'Reset link ready' });
    expect(within(link).getByDisplayValue('https://hiusa.example.test/reset-password?token=abc')).toBeInTheDocument();
    fireEvent.click(within(link).getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(/reset-password/)).not.toBeInTheDocument();
    expect(screen.getByText('Reset link created for Ana Cruz.')).toBeInTheDocument();
  });

  it('describes a one-time link and does not promise an email while mail is off', async () => {
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    const confirm = screen.getByRole('dialog', { name: 'Create reset link' });
    expect(within(confirm).getByText(/one-time reset link/i)).toHaveTextContent(/shown to you once to hand over/i);
    expect(within(confirm).getByText(/one-time reset link/i)).toHaveTextContent(/emailed only when email is turned on/i);
    expect(within(confirm).queryByText(/will be sent/i)).not.toBeInTheDocument();
  });

  it('shows the confirmation message instead of a link when the reset was emailed', async () => {
    service.resetSystemUserPassword.mockResolvedValue({ message: 'Password reset instructions were sent to the account email address.' });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Create reset link' })).getByRole('button', { name: 'Create reset link' }));
    expect(await screen.findByText('Password reset instructions were sent to the account email address.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Reset link ready' })).not.toBeInTheDocument();
  });

  it('keeps the reset dialog open and says why when the reset fails', async () => {
    service.resetSystemUserPassword.mockRejectedValue({ response: { data: { message: 'Activate this account before initiating a password reset.' } } });
    render(<SaoUsersPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Ana Cruz' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    const confirm = screen.getByRole('dialog', { name: 'Create reset link' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Create reset link' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Activate this account before initiating a password reset.');
    expect(screen.queryByRole('dialog', { name: 'Reset link ready' })).not.toBeInTheDocument();
  });

  it('offers a password reset for active students, officers and administrators, and for nobody else', async () => {
    service.getSystemUsers.mockResolvedValue(page([
      { ...user, school_id: 1, first_name: 'Ben', role: 'SBO_OFFICER' },
      { ...user, school_id: 2, first_name: 'Cara', account_status: 'inactive' },
      { ...user, school_id: 3, first_name: 'Dan', role: 'ADMIN' },
      { ...user, school_id: 4, first_name: 'Eve', role: 'SUPER_ADMIN' },
      { ...user, school_id: 5, first_name: 'Finn', role: 'ADMIN', account_status: 'disabled' },
      { ...user, school_id: 6, first_name: 'Gia', role: 'DEPARTMENT_HEAD' },
    ]));
    render(<SaoUsersPage />);
    for (const name of ['Ben', 'Dan']) {
      fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${name} Cruz` }))[0]);
      expect(screen.getByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
    for (const name of ['Cara', 'Eve', 'Finn', 'Gia']) {
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
