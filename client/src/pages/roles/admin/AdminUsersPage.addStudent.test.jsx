import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUsersPage from './AdminUsersPage';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  getProfileOrganizations: vi.fn(),
  inviteAccountProfile: vi.fn(),
  searchPeople: vi.fn(),
}));

vi.mock('../../../services/userService', () => ({
  deleteUser: vi.fn(),
  disableUser: vi.fn(),
  getAcademicStructure: vi.fn().mockResolvedValue({ department: 'College of Computing', programs: [] }),
  getSboPositions: vi.fn().mockResolvedValue([]),
  getUsers: mocks.getUsers,
  reactivateUser: vi.fn(),
  updateUser: vi.fn(),
  uploadUserPhoto: vi.fn(),
}));
vi.mock('../../../services/authService', () => ({ getProfileOrganizations: mocks.getProfileOrganizations, inviteAccountProfile: mocks.inviteAccountProfile }));
vi.mock('../../../services/peopleService', () => ({ searchPeople: mocks.searchPeople }));
vi.mock('../../../components/org/OrgAccessPanel', () => ({ default: () => null }));
vi.mock('../../../services/financeService', () => ({ getStudentDebts: vi.fn() }));
vi.mock('../../../hooks/useFingerprintReader', () => ({ useFingerprintReader: () => ({ connected: false, scanning: false, mock: false, error: null, retry: vi.fn() }) }));

const maria = { school_id: 24001001, name: 'Maria Reyes', email: 'maria@example.test', program: 'BSIT', role: 'STUDENT', organizations: [] };

describe('AdminUsersPage add existing student', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 1, role: 'ADMIN', organization_id: 8 }));
    mocks.getUsers.mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0, per_page: 10, summary: { by_role: {}, by_section: [] } });
    mocks.getProfileOrganizations.mockResolvedValue({ data: [{ id: 8, name: 'Computing Council' }] });
    mocks.searchPeople.mockResolvedValue([maria]);
    mocks.inviteAccountProfile.mockResolvedValue({ data: { id: 5 } });
  });

  it('adds a student by name and no longer offers a create-user form with a school ID and password', async () => {
    render(<AdminUsersPage />);
    expect(screen.queryByRole('button', { name: /new user/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /add existing student/i }));
    expect(screen.getByText('Students without an account sign up themselves with their school ID.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Student' }), { target: { value: 'maria' } });
    fireEvent.click(await screen.findByRole('option', { name: /Maria Reyes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add student' }));
    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 24001001, organization_id: 8, role: 'STUDENT' }));
  });

  it('names the position under an administrator and drops the program column when nobody has one', async () => {
    mocks.getUsers.mockResolvedValue({
      data: [{ id: 3, school_id: 990002, first_name: 'Organization', last_name: 'Adviser', role: 'ADMIN', position_title: 'Adviser', account_status: 'active' }],
      current_page: 1, last_page: 1, total: 1, per_page: 20, summary: { by_role: { ADMIN: 1 }, by_section: [] },
    });
    render(<AdminUsersPage />);

    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByText('Adviser')).toBeInTheDocument();
    expect(within(table).getByText('Administrator')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Program' })).not.toBeInTheDocument();
  });

  it('lists users in a captioned table with a badge only on accounts that are not active', async () => {
    mocks.getUsers.mockResolvedValue({
      data: [
        { id: 1, school_id: 24001001, first_name: 'ana', last_name: 'reyes', role: 'STUDENT', account_status: 'active', program: 'BSIT', year_level: '1st Year', section: 'A', fingerprint_enrolled: true },
        { id: 2, school_id: 24001002, first_name: 'ben', last_name: 'cruz', role: 'STUDENT', account_status: 'disabled', program: 'BSIT', year_level: '2nd Year', section: 'B', fingerprint_enrolled: false },
      ],
      current_page: 1, last_page: 1, total: 2, per_page: 20, summary: { by_role: { STUDENT: 2 }, by_section: [] },
    });
    render(<AdminUsersPage />);

    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(table).getAllByText('Disabled')).toHaveLength(1);
    expect(within(table).queryByText('Active')).not.toBeInTheDocument();
    expect(within(table).getByText('Fingerprint enrolled')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Fingerprint' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(mocks.getUsers).toHaveBeenCalledWith(expect.objectContaining({ per_page: 20 }));
  });
});
