import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePasswordPage from './ChangePasswordPage';

const profileMocks = vi.hoisted(() => ({
  updatePassword: vi.fn(),
}));

vi.mock('../../services/profileService', () => profileMocks);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/change-password']}>
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/dashboard" element={<p>Dashboard home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fill({ current = '4321-uclm', next = 'my-own-secret', confirm = 'my-own-secret' } = {}) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
}

function rejection(status, data) {
  return Object.assign(new Error('Request failed'), { response: { status, data } });
}

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'New', must_change_password: true }));
    profileMocks.updatePassword.mockResolvedValue({ data: { message: 'Password updated successfully.' } });
  });

  it('explains why the change is required and shows the rules before anything is typed', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByText('Your account was created with a default password. Set your own before you continue.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save new password' })).toHaveLength(1);
  });

  it('focuses the first invalid field and names the problem next to it', () => {
    renderPage();

    fill({ current: '', next: 'short', confirm: 'short' });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(screen.getByText('Enter your current password.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.', { selector: '[role="alert"]' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveFocus();
    expect(profileMocks.updatePassword).not.toHaveBeenCalled();
  });

  it('catches a confirmation that does not match without calling the server', () => {
    renderPage();

    fill({ confirm: 'something-else' });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(screen.getByText('The confirmation does not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toHaveFocus();
    expect(profileMocks.updatePassword).not.toHaveBeenCalled();
  });

  it('saves, clears the flag in the stored user and opens the role home', async () => {
    renderPage();

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    await waitFor(() => expect(profileMocks.updatePassword).toHaveBeenCalledWith({
      current_password: '4321-uclm',
      password: 'my-own-secret',
      password_confirmation: 'my-own-secret',
    }));
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('user'));
    expect(stored.must_change_password).toBe(false);
    expect(stored.role).toBe('STUDENT');
    expect(localStorage.getItem('auth_token')).toBe('token');
  });

  it('puts a wrong current password on the current password field', async () => {
    profileMocks.updatePassword.mockRejectedValue(rejection(422, { message: 'Current password is incorrect.' }));
    renderPage();

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveFocus());
    expect(JSON.parse(localStorage.getItem('user')).must_change_password).toBe(true);
  });

  it('puts a reused default password on the new password field', async () => {
    profileMocks.updatePassword.mockRejectedValue(rejection(422, { message: 'Choose a password different from your current one.' }));
    renderPage();

    fill({ next: '4321-uclm', confirm: '4321-uclm' });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('Choose a password different from your current one.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('New password')).toHaveFocus());
  });

  it('shows server field errors beside their fields', async () => {
    profileMocks.updatePassword.mockRejectedValue(rejection(422, {
      message: 'The password field must be at least 8 characters.',
      errors: { password: ['The password field must be at least 8 characters.'] },
    }));
    renderPage();

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('The password field must be at least 8 characters.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('New password')).toHaveFocus());
  });
});
