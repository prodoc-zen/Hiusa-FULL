import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
