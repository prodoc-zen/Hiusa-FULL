import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RecoverAccountPage from './RecoverAccountPage';
import ResetPasswordPage from './ResetPasswordPage';

const authMocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  validatePasswordResetToken: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock('../../services/authService', () => authMocks);

describe('password recovery pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authMocks.requestPasswordReset.mockResolvedValue({ data: { message: 'Reset requested.' } });
    authMocks.validatePasswordResetToken.mockResolvedValue({ data: { message: 'Token valid.' } });
    authMocks.resetPassword.mockResolvedValue({ data: { message: 'Password updated successfully.' } });
  });

  it('requests a reset with one email or school ID field without revealing account existence', async () => {
    render(
      <MemoryRouter initialEntries={['/recover-account']}>
        <Routes>
          <Route path="/recover-account" element={<RecoverAccountPage />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('School ID / ID number')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email or school ID'), { target: { value: ' dean@example.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({ identifier: 'dean@example.test' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/If an account matches/)).toBeInTheDocument();
  });

  it('validates the emailed token and submits a confirmed replacement password', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password?organization_id=14&email=admin%40example.test&token=secret-token']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(authMocks.validatePasswordResetToken).toHaveBeenCalledWith({
      organization_id: '14',
      email: 'admin@example.test',
      token: 'secret-token',
    }));

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'Replacement-Password-123!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Replacement-Password-123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(authMocks.resetPassword).toHaveBeenCalledWith({
      organization_id: '14',
      email: 'admin@example.test',
      token: 'secret-token',
      password: 'Replacement-Password-123!',
      password_confirmation: 'Replacement-Password-123!',
    }));
    expect(await screen.findByText('Password updated successfully.')).toBeInTheDocument();
  });
});
