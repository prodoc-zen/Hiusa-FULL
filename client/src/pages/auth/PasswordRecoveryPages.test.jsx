import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('button', { name: 'Request reset' }));

    await waitFor(() => expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({ identifier: 'dean@example.test' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/If an account matches/)).toBeInTheDocument();
  });

  it('says before submitting what happens with email on and with email off', () => {
    render(
      <MemoryRouter initialEntries={['/recover-account']}>
        <Routes><Route path="/recover-account" element={<RecoverAccountPage />} /></Routes>
      </MemoryRouter>,
    );

    const intro = screen.getByText(/When email is turned on/);
    expect(intro).toHaveTextContent(/When it is off, this page says so and you ask your organization Admin or the SAO for a one-time link\./);
    expect(intro).toHaveTextContent(/SAO staff ask another SAO account holder\./);
    expect(intro).not.toHaveTextContent(/^Enter the email or school ID you sign in with\. We send/);
  });

  it('tells the person to ask for a reset, without claiming an email was sent, when mail is off', async () => {
    authMocks.requestPasswordReset.mockResolvedValue({ data: { message: 'Password reset by email is not available. Ask your organization Admin or the SAO to reset your password.', email_sent: false } });
    render(
      <MemoryRouter initialEntries={['/recover-account']}>
        <Routes>
          <Route path="/recover-account" element={<RecoverAccountPage />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email or school ID'), { target: { value: 'dean@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request reset' }));

    expect(await screen.findByRole('heading', { name: 'Ask for a reset' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing was sent to anyone\. Someone else has to give you a one-time link to choose a new password\./)).toBeInTheDocument();
    const who = screen.getByRole('list', { name: 'Who can reset your password' });
    expect(within(who).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Students and officers: your organization Admin, or the SAO.',
      'Organization Admins, office staff and Department Heads: the SAO.',
      'SAO staff: another SAO account holder.',
      'The only SAO account: whoever looks after the server runs the reset command in the deployment guide (hiusa:reset-sao-password).',
    ]);
    expect(screen.queryByText(/we sent/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send another email' })).not.toBeInTheDocument();
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

  it('titles a reset link with missing parts as not valid, not expired', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('This reset link is not valid')).toBeInTheDocument();
    expect(screen.getByText('This reset link is incomplete. Request a new one.')).toBeInTheDocument();
    expect(screen.queryByText('This reset link has expired')).not.toBeInTheDocument();
    expect(authMocks.validatePasswordResetToken).not.toHaveBeenCalled();
  });

  it('still titles a link the server rejects as expired', async () => {
    authMocks.validatePasswordResetToken.mockRejectedValue({ response: { data: { message: 'Password reset token is invalid or expired.' } } });
    render(
      <MemoryRouter initialEntries={['/reset-password?organization_id=1&email=a%40b.com&token=wrong']}>
        <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('This reset link has expired')).toBeInTheDocument();
    expect(screen.getByText('Password reset token is invalid or expired.')).toBeInTheDocument();
  });
});
