import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoUsersPage from './SaoUsersPage';

const service = vi.hoisted(() => ({ getSystemUsers: vi.fn(), getSystemUser: vi.fn(), deleteSystemUser: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => service);

const user = { school_id: 20261234, first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.test', role: 'STUDENT', account_status: 'active', organization: { id: 7, name: 'Computing Society' } };
const page = (rows) => ({ data: rows, current_page: 1, last_page: 1, per_page: 20, total: rows.length });

describe('SAO university users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSystemUsers.mockResolvedValue(page([user]));
    service.getSystemUser.mockResolvedValue({ user: { ...user, profiles: [{ id: 1, role: 'STUDENT', organization: user.organization }] }, clearances: [{ period_id: 3, title: 'First Semester', academic_year: '2026-2027', is_complete: false, signatures: [{ required_role: 'sao', status: 'held' }] }], linked_records: { profiles: 1 } });
    service.deleteSystemUser.mockResolvedValue({ message: 'Deleted.' });
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
