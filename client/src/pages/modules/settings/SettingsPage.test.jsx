import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';

const profileMocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  getMyActivity: vi.fn(() => Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, total: 0 } })),
  getNotificationPreferences: vi.fn(() => Promise.resolve({ data: { muted: [], mutable: ['announcement', 'event', 'election', 'merchandise'] } })),
  updateNotificationPreferences: vi.fn(),
}));

vi.mock('../../../services/profileService', () => profileMocks);

const storedUser = {
  school_id: 940001,
  first_name: 'Ramon',
  last_name: 'Castillo',
  email: 'dean.ccs@hiusa.local',
  role: 'DEPARTMENT_HEAD',
  organization: { name: 'Philippine Society of Information Technology Students' },
};

function renderPage() {
  localStorage.setItem('user', JSON.stringify(storedUser));
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('presents a complete account summary and keeps unchanged profile actions disabled', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Personal information' })).toBeInTheDocument();
    expect(screen.getByText('Ramon Castillo')).toBeInTheDocument();
    expect(screen.getByText('940001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
  });

  it('shows no school ID for an account that joined by invite link and only has an internal number', () => {
    localStorage.setItem('user', JSON.stringify({ ...storedUser, school_id: 95000007 }));
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByText('Ramon Castillo')).toBeInTheDocument();
    expect(screen.queryByText('95000007')).not.toBeInTheDocument();
    expect(screen.queryByText(/School ID/i)).not.toBeInTheDocument();
  });

  it('shows a plain job title instead of the role enum', () => {
    localStorage.setItem('user', JSON.stringify({ ...storedUser, role: 'SUPER_ADMIN', position_title: 'SAO Director', organization: null }));
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByText('SAO Director')).toBeInTheDocument();
    expect(screen.queryByText(/SUPER_ADMIN/)).not.toBeInTheDocument();
    expect(screen.queryByText('Selected organization')).not.toBeInTheDocument();
  });

  it('saves changed profile information and refreshes the stored identity', async () => {
    profileMocks.updateProfile.mockResolvedValue({ data: { ...storedUser, first_name: 'Ramona' } });
    renderPage();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ramona' } });
    fireEvent.change(screen.getByLabelText('Confirm with your current password'), { target: { value: 'current-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileMocks.updateProfile).toHaveBeenCalledWith({
      first_name: 'Ramona',
      last_name: 'Castillo',
      email: 'dean.ccs@hiusa.local',
      contact_number: null,
      current_password: 'current-secret',
    }));
    expect(await screen.findByText('Profile changes saved.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('user')).first_name).toBe('Ramona');
    expect(screen.queryByLabelText('Confirm with your current password')).not.toBeInTheDocument();
  });

  it('asks for the current password before a name or email change is sent', async () => {
    renderPage();
    expect(screen.queryByLabelText('Confirm with your current password')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new.dean@hiusa.local' } });
    expect(screen.getByLabelText('Confirm with your current password')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your current password to change your name or email.');
    expect(profileMocks.updateProfile).not.toHaveBeenCalled();
  });

  it('removes the red message from the profile form when the changes are discarded', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('First name, last name, and email are required.');

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByLabelText('First name')).toHaveValue('Ramon');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the server message when the current password is wrong', async () => {
    profileMocks.updateProfile.mockRejectedValue({ response: { status: 422, data: { message: 'The given data was invalid.', errors: { current_password: ['Current password is incorrect.'] } } } });
    renderPage();

    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reyes' } });
    fireEvent.change(screen.getByLabelText('Confirm with your current password'), { target: { value: 'wrong-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findAllByText('Current password is incorrect.')).not.toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('user')).last_name).toBe('Castillo');
  });

  it('lets a user add an optional mobile number', async () => {
    profileMocks.updateProfile.mockResolvedValue({ data: { ...storedUser, contact_number: '09171234567' } });
    renderPage();

    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '09171234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileMocks.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ contact_number: '09171234567' })));
    expect(JSON.parse(localStorage.getItem('user')).contact_number).toBe('09171234567');
  });

  it('provides independent password visibility controls and blocks mismatched passwords', async () => {
    renderPage();

    const currentPassword = screen.getByLabelText('Current password');
    const newPassword = screen.getByLabelText('New password');
    const confirmation = screen.getByLabelText('Confirm new password');
    expect(currentPassword).toHaveAttribute('type', 'password');
    expect(newPassword).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show current password' }));
    expect(currentPassword).toHaveAttribute('type', 'text');
    expect(newPassword).toHaveAttribute('type', 'password');

    fireEvent.change(currentPassword, { target: { value: 'current-secret' } });
    fireEvent.change(newPassword, { target: { value: 'new-secret' } });
    fireEvent.change(confirmation, { target: { value: 'different-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('New passwords do not match.');
    expect(profileMocks.updatePassword).not.toHaveBeenCalled();
  });

  it('keeps the session after a password change and clears the stored change-required flag', async () => {
    profileMocks.updatePassword.mockResolvedValue({ data: { message: 'Password updated successfully.', user: { ...storedUser, must_change_password: false } } });
    renderPage();
    localStorage.setItem('auth_token', 'session-token');
    localStorage.setItem('user', JSON.stringify({ ...storedUser, must_change_password: true }));

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-secret' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-secret-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password updated. Your other devices were signed out.')).toBeInTheDocument();
    expect(profileMocks.updatePassword).toHaveBeenCalledWith({ current_password: 'current-secret', password: 'new-secret-1', password_confirmation: 'new-secret-1' });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(localStorage.getItem('auth_token')).toBe('session-token');
    expect(JSON.parse(localStorage.getItem('user')).must_change_password).toBe(false);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });
});
