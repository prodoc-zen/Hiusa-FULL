import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptInvitationPage from './AcceptInvitationPage';
import * as adminService from '../../services/systemAdministrationService';

vi.mock('../../services/systemAdministrationService', () => ({
  getDepartmentHeadInvitation: vi.fn(),
  acceptDepartmentHeadInvitation: vi.fn(),
}));

describe('AcceptInvitationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows error when token is missing', async () => {
    render(
      <MemoryRouter initialEntries={['/accept-invitation']}>
        <Routes>
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/No invitation token was provided/i)).toBeInTheDocument();
  });

  it('loads invitation details and lets Dean accept with password and school ID', async () => {
    adminService.getDepartmentHeadInvitation.mockResolvedValueOnce({
      invitation: {
        id: 1,
        first_name: 'Arthur',
        last_name: 'Dent',
        email: 'arthur@example.edu',
        school_id: null,
      },
      college: {
        id: 5,
        name: 'College of Arts and Sciences',
      },
    });

    adminService.acceptDepartmentHeadInvitation.mockResolvedValueOnce({
      token: 'mock-auth-token',
      user: {
        school_id: 20261111,
        first_name: 'Arthur',
        last_name: 'Dent',
        role: 'DEPARTMENT_HEAD',
      },
    });

    render(
      <MemoryRouter initialEntries={['/accept-invitation?token=valid-secret-token']}>
        <Routes>
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Welcome, Arthur Dent/i)).toBeInTheDocument();
    expect(screen.getByText(/College of Arts and Sciences/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/School ID/), { target: { value: '20261111' } });
    fireEvent.change(screen.getByLabelText(/^Create password/), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: 'Password123!' } });

    fireEvent.click(screen.getByRole('button', { name: /Activate & Enter Workspace/i }));

    await waitFor(() => {
      expect(adminService.acceptDepartmentHeadInvitation).toHaveBeenCalledWith('valid-secret-token', {
        school_id: 20261111,
        password: 'Password123!',
        password_confirmation: 'Password123!',
      });
    });

    expect(await screen.findByText(/Welcome, Department Head!/i)).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('mock-auth-token');
  });

  it('validates mismatched passwords before submitting', async () => {
    adminService.getDepartmentHeadInvitation.mockResolvedValueOnce({
      invitation: {
        id: 2,
        first_name: 'Elena',
        last_name: 'Reyes',
        email: 'elena@example.edu',
        school_id: 20262222,
      },
      college: {
        id: 6,
        name: 'College of Engineering',
      },
    });

    render(
      <MemoryRouter initialEntries={['/accept-invitation?token=valid-token']}>
        <Routes>
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText(/Welcome, Elena Reyes/i);

    fireEvent.change(screen.getByLabelText(/^Create password/), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: 'MismatchPass!' } });

    fireEvent.click(screen.getByRole('button', { name: /Activate & Enter Workspace/i }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(adminService.acceptDepartmentHeadInvitation).not.toHaveBeenCalled();
  });
});

