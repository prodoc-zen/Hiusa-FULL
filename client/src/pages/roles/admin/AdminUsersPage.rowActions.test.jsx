import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUsersPage from './AdminUsersPage';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  updateUser: vi.fn(),
  disableUser: vi.fn(),
}));

vi.mock('../../../services/userService', () => ({
  deleteUser: vi.fn(),
  disableUser: mocks.disableUser,
  getAcademicStructure: vi.fn().mockResolvedValue({ department: 'College of Computing', programs: [{ id: 1, name: 'BSIT', duration_years: 4, sections: [] }] }),
  getSboPositions: vi.fn().mockResolvedValue([]),
  getUsers: mocks.getUsers,
  reactivateUser: vi.fn(),
  updateUser: mocks.updateUser,
  uploadUserPhoto: vi.fn(),
}));
vi.mock('../../../services/authService', () => ({ getProfileOrganizations: vi.fn(), inviteAccountProfile: vi.fn() }));
vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));
vi.mock('../../../components/org/OrgAccessPanel', () => ({ default: () => null }));
vi.mock('../../../services/financeService', () => ({ getStudentDebts: vi.fn() }));
vi.mock('../../../hooks/useFingerprintReader', () => ({ useFingerprintReader: () => ({ connected: false, scanning: false, mock: false, error: null, retry: vi.fn() }) }));

const ana = { id: 1, school_id: 24001001, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.test', role: 'STUDENT', account_status: 'active', program: 'BSIT', year_level: '1st Year' };
const ben = { id: 2, school_id: 24001002, first_name: 'Ben', last_name: 'Cruz', email: 'ben@example.test', role: 'SBO_OFFICER', account_status: 'active', position_title: 'Treasurer' };

async function openMenuItem(person, item) {
  fireEvent.click((await screen.findAllByRole('button', { name: `Open actions for ${person}` }))[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('AdminUsersPage row actions and empty values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 900001, role: 'ADMIN', organization_id: 8 }));
    mocks.getUsers.mockResolvedValue({ data: [ana, ben], current_page: 1, last_page: 1, total: 2, per_page: 20, summary: { by_role: { STUDENT: 1, SBO_OFFICER: 1 }, by_section: [] } });
  });

  it('does not offer Department head as a role when editing a user, since only the SAO creates heads', async () => {
    render(<AdminUsersPage />);
    await openMenuItem('Ana Reyes', 'Edit Ana Reyes');

    const role = await screen.findByLabelText('Role');
    const offered = within(role).getAllByRole('option').map((option) => option.textContent);
    expect(offered).toContain('Student');
    expect(offered).not.toContain('Department head');
  });

  it('shows a refused edit once, under the field it belongs to', async () => {
    mocks.updateUser.mockRejectedValue({ response: { status: 422, data: { message: 'The selected role is invalid.', errors: { role: ['The selected role is invalid.'] } } } });
    render(<AdminUsersPage />);
    await openMenuItem('Ana Reyes', 'Edit Ana Reyes');

    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalled());
    expect(await screen.findAllByText('The selected role is invalid.')).toHaveLength(1);
  });

  it('closes the deactivate dialog and shows the refusal when the server says no', async () => {
    mocks.disableUser.mockRejectedValue({ response: { status: 403, data: { message: 'Administrator accounts are managed only from SAO Administration.' } } });
    render(<AdminUsersPage />);
    await openMenuItem('Ana Reyes', 'Deactivate Ana Reyes');

    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText('Administrator accounts are managed only from SAO Administration.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate user' })).not.toBeInTheDocument());
  });

  it('leaves the Program label off a phone card that has nothing to show under it', async () => {
    const { container } = render(<AdminUsersPage />);
    await screen.findAllByText('Ben Cruz');

    const cards = container.querySelector('[data-view="cards"]');
    expect(within(cards).getAllByText('Program')).toHaveLength(1);
  });

  it('writes Not set for a profile field with no value instead of leaving it blank', async () => {
    render(<AdminUsersPage />);
    await openMenuItem('Ben Cruz', 'View Ben Cruz');

    const contact = (await screen.findByText('Contact number')).closest('div');
    expect(within(contact).getByText('Not set')).toBeInTheDocument();
    expect(within(screen.getByText('Email').closest('div')).getByText('ben@example.test')).toBeInTheDocument();
  });
});
