import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock('../../services/authService', () => authMocks);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard/student" element={<p>Student dashboard</p>} />
        <Route path="/change-password" element={<p>Change password page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authMocks.login.mockResolvedValue({
      data: {
        access_token: 'test-token',
        user: { school_id: 2100142, role: 'STUDENT' },
      },
    });
  });

  it('signs every account in with a school ID instead of an email address', async () => {
    renderPage();

    const schoolIdInput = screen.getByPlaceholderText('Enter your school ID or ID number');
    expect(schoolIdInput).toHaveAttribute('inputmode', 'numeric');
    expect(screen.queryByPlaceholderText('Enter your email address')).not.toBeInTheDocument();

    fireEvent.change(schoolIdInput, { target: { value: 'ID-2100142' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Demo@12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authMocks.login).toHaveBeenCalledWith({
      school_id: '2100142',
      password: 'Demo@12345',
    }));
    expect(await screen.findByText('Student dashboard')).toBeInTheDocument();
  });

  it('sends a user who must change a default password to the change password page instead of the dashboard', async () => {
    authMocks.login.mockResolvedValue({
      data: {
        access_token: 'test-token',
        user: { school_id: 2100142, role: 'STUDENT', must_change_password: true },
      },
    });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('Enter your school ID or ID number'), { target: { value: '2100142' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: '0142-uclm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Change password page')).toBeInTheDocument();
    expect(screen.queryByText('Student dashboard')).not.toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('test-token');
  });
});
