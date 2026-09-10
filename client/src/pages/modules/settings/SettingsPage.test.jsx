import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';

const profileMocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
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

    expect(screen.getByRole('heading', { name: 'Manage your profile' })).toBeInTheDocument();
    expect(screen.getByText('Ramon Castillo')).toBeInTheDocument();
    expect(screen.getByText('940001')).toBeInTheDocument();
    expect(screen.getByText('Protected account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
  });

  it('saves changed profile information and refreshes the stored identity', async () => {
    profileMocks.updateProfile.mockResolvedValue({ data: { ...storedUser, first_name: 'Ramona' } });
    renderPage();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ramona' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileMocks.updateProfile).toHaveBeenCalledWith({
      first_name: 'Ramona',
      last_name: 'Castillo',
      email: 'dean.ccs@hiusa.local',
    }));
    expect(await screen.findByText('Profile changes saved.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('user')).first_name).toBe('Ramona');
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
});
