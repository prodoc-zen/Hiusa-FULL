import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUsersPage from './AdminUsersPage';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  resetUserPassword: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../../../services/userService', () => ({
  deleteUser: vi.fn(),
  disableUser: vi.fn(),
  getAcademicStructure: vi.fn().mockResolvedValue({ department: 'College of Computing', programs: [] }),
  getSboPositions: vi.fn().mockResolvedValue([]),
  getUsers: mocks.getUsers,
  reactivateUser: vi.fn(),
  resetUserPassword: mocks.resetUserPassword,
  updateUser: mocks.updateUser,
  uploadUserPhoto: vi.fn(),
}));
vi.mock('../../../components/org/OrgAccessPanel', () => ({ default: () => null }));
vi.mock('../../../services/financeService', () => ({ getStudentDebts: vi.fn() }));
vi.mock('../../../hooks/useFingerprintReader', () => ({ useFingerprintReader: () => ({ connected: false, scanning: false, mock: false, error: null, retry: vi.fn() }) }));

const ana = { id: 1, school_id: 24001001, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test', role: 'STUDENT', account_status: 'active', program: 'BSIT' };

async function openEditFor(name) {
  render(<AdminUsersPage />);
  fireEvent.click((await screen.findAllByRole('button', { name: `Open actions for ${name}` }))[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: `Edit ${name}` }));
  return screen.findByRole('dialog', { name: 'Edit user' });
}

describe('AdminUsersPage reset member password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 1, role: 'ADMIN', organization_id: 8 }));
    mocks.getUsers.mockResolvedValue({ data: [ana], current_page: 1, last_page: 1, total: 1, per_page: 20, summary: { by_role: { STUDENT: 1 }, by_section: [] } });
  });

  it('offers a reset action instead of password or email fields and shows the link once', async () => {
    mocks.resetUserPassword.mockResolvedValue({ message: 'The reset link is ready.', reset_link: 'https://hiusa.example.test/reset-password?token=abc' });
    const drawer = await openEditFor('Ana Reyes');

    expect(within(drawer).queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText(/email/i)).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(mocks.resetUserPassword).toHaveBeenCalledWith(1));
    expect(await screen.findByDisplayValue('https://hiusa.example.test/reset-password?token=abc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue('https://hiusa.example.test/reset-password?token=abc')).not.toBeInTheDocument();
  });

  it('shows the open voting message inline and keeps the form open', async () => {
    const message = "Voting is open in your organization. Ask the SAO to reset this member's password until the election closes.";
    mocks.resetUserPassword.mockRejectedValue({ response: { status: 409, data: { message } } });
    const drawer = await openEditFor('Ana Reyes');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Reset password' }));

    expect(await within(drawer).findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('tells the Admin that the SAO resets the password of a member whose primary profile is elsewhere', async () => {
    mocks.getUsers.mockResolvedValue({ data: [{ ...ana, is_primary_profile: false }], current_page: 1, last_page: 1, total: 1, per_page: 20, summary: { by_role: { STUDENT: 1 }, by_section: [] } });
    const drawer = await openEditFor('Ana Reyes');

    expect(within(drawer).getByText('The SAO resets this password.')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });

  it('shows the elevated-access refusal inline and keeps the form open', async () => {
    const message = 'Ask the SAO to reset this password.';
    mocks.resetUserPassword.mockRejectedValue({ response: { status: 409, data: { message } } });
    const drawer = await openEditFor('Ana Reyes');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Reset password' }));

    expect(await within(drawer).findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('does not send an email or password when saving an edit', async () => {
    mocks.updateUser.mockResolvedValue({});
    const drawer = await openEditFor('Ana Reyes');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    const payload = mocks.updateUser.mock.calls[0][1];
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('password');
  });
});
