import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SaoUsersPage from './SaoUsersPage';

const service = vi.hoisted(() => ({
  getSystemUsers: vi.fn(), getSystemUser: vi.fn(), deleteSystemUser: vi.fn(), resetSystemUserPassword: vi.fn(),
  setSystemUserStatus: vi.fn(), updateSystemUser: vi.fn(),
  createSaoStaffInvitation: vi.fn(), getSaoStaffInvitations: vi.fn(), relinkSaoStaffInvitation: vi.fn(), revokeSaoStaffInvitation: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => service);

const staff = { school_id: 990002, first_name: 'Other', last_name: 'Staff', email: 'other@example.test', role: 'SUPER_ADMIN', account_status: 'active', organization: { id: 1, name: 'Student Affairs Office' } };
const page = (rows) => ({ data: rows, current_page: 1, last_page: 1, per_page: 20, total: rows.length });
const openMenu = async (name) => fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${name}` }))[0]);

describe('SAO account control on University users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 990001, role: 'SUPER_ADMIN' }));
    service.getSystemUsers.mockResolvedValue(page([staff]));
    service.setSystemUserStatus.mockResolvedValue({ message: 'Account deactivated.' });
    service.updateSystemUser.mockResolvedValue({ message: 'Account updated.' });
  });
  afterEach(() => localStorage.removeItem('user'));

  it('deactivates an active account after a confirmation and says so', async () => {
    render(<SaoUsersPage />);
    await openMenu('Other Staff');
    expect(screen.queryByRole('menuitem', { name: 'Reactivate' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate account?' });
    expect(within(dialog).getByText(/signed out/i)).toBeInTheDocument();
    expect(service.setSystemUserStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(service.setSystemUserStatus).toHaveBeenCalledWith(990002, 'disabled'));
    expect(await screen.findByText('Other Staff was deactivated.')).toBeInTheDocument();
    await waitFor(() => expect(service.getSystemUsers).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Deactivate account?' })).not.toBeInTheDocument();
  });

  it('reactivates a disabled or inactive account', async () => {
    service.getSystemUsers.mockResolvedValue(page([{ ...staff, account_status: 'disabled' }]));
    service.setSystemUserStatus.mockResolvedValue({ message: 'Account reactivated.' });
    render(<SaoUsersPage />);
    await openMenu('Other Staff');
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivate' }));
    const dialog = screen.getByRole('dialog', { name: 'Reactivate account?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(service.setSystemUserStatus).toHaveBeenCalledWith(990002, 'active'));
    expect(await screen.findByText('Other Staff was reactivated.')).toBeInTheDocument();
  });

  it('keeps the dialog open and gives the server reason when the change is refused', async () => {
    service.setSystemUserStatus.mockRejectedValue({ response: { status: 409, data: { message: 'The last active SAO account cannot be deactivated.' } } });
    render(<SaoUsersPage />);
    await openMenu('Other Staff');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate account?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The last active SAO account cannot be deactivated.');
    expect(screen.queryByText(/was deactivated/)).not.toBeInTheDocument();
  });

  it('offers neither on the signed-in account nor on a Department Head, who is managed from Colleges', async () => {
    service.getSystemUsers.mockResolvedValue(page([
      { ...staff, school_id: 990001, first_name: 'Own', last_name: 'Account' },
      { ...staff, school_id: 990003, first_name: 'Dean', last_name: 'Head', role: 'DEPARTMENT_HEAD' },
    ]));
    render(<SaoUsersPage />);
    for (const name of ['Own Account', 'Dean Head']) {
      await openMenu(name);
      expect(screen.getByRole('menuitem', { name: 'View user and clearance' })).toBeInTheDocument();
      for (const hidden of ['Deactivate', 'Reactivate', 'Edit details']) expect(screen.queryByRole('menuitem', { name: hidden })).not.toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('corrects a name and email from a form that starts with the current values', async () => {
    render(<SaoUsersPage />);
    await openMenu('Other Staff');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit details' });
    expect(within(dialog).getByLabelText('First name')).toHaveValue('Other');
    expect(within(dialog).getByLabelText('Last name')).toHaveValue('Staff');
    expect(within(dialog).getByLabelText('Email')).toHaveValue('other@example.test');
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: ' Otto ' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'otto@example.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(service.updateSystemUser).toHaveBeenCalledWith(990002, { first_name: 'Otto', last_name: 'Staff', email: 'otto@example.test' }));
    expect(await screen.findByText('Details saved for Otto Staff.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit details' })).not.toBeInTheDocument();
  });

  it('blocks an empty name or a bad email, and shows the server reason for an email already in use', async () => {
    service.updateSystemUser.mockRejectedValue({ response: { status: 422, data: { message: 'The email has already been taken.', errors: { email: ['The email has already been taken.'] } } } });
    render(<SaoUsersPage />);
    await openMenu('Other Staff');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit details' });
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: '  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter a first name.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Otto' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(service.updateSystemUser).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'taken@example.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The email has already been taken.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit details' })).toBeInTheDocument();
  });
});
