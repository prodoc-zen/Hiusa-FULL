import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemAdminsPage from './SystemAdminsPage';

const serviceMocks = vi.hoisted(() => ({
  getSystemAdmins: vi.fn(),
  getSystemOrganizations: vi.fn(),
  createSystemAdmin: vi.fn(),
  updateSystemAdmin: vi.fn(),
  initiateSystemAdminPasswordReset: vi.fn(),
}));

vi.mock('../../../services/systemAdministrationService', () => serviceMocks);

describe('SystemAdminsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getSystemAdmins.mockResolvedValue({ data: [{
      school_id: 10101,
      first_name: 'Ana',
      last_name: 'Reyes',
      email: 'ana@example.test',
      organization_id: 8,
      account_status: 'active',
      position_title: 'Adviser',
      organization: { id: 8, name: 'Computing Council', acronym: 'CC' },
    }] });
    serviceMocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 8, name: 'Computing Council', acronym: 'CC', is_active: true }] });
    serviceMocks.createSystemAdmin.mockResolvedValue({});
    serviceMocks.updateSystemAdmin.mockResolvedValue({});
    serviceMocks.initiateSystemAdminPasswordReset.mockResolvedValue({ message: 'Password reset instructions were sent.' });
  });

  it('requires and submits the initial password when SAO creates an Admin', async () => {
    render(<SystemAdminsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New Admin User' }));

    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(screen.getByText(/SAO sets the initial password/i)).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Adviser"]')).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Organization Adviser"]')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/School ID/i), { target: { value: '20260001' } });
    fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: 'Maria' } });
    fireEvent.change(screen.getByLabelText(/Last name/i), { target: { value: 'Santos' } });
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'MARIA@example.test' } });
    fireEvent.change(screen.getByLabelText(/Assigned organization/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'Initial-Password-123!' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: 'Initial-Password-123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Admin User' }));

    await waitFor(() => expect(serviceMocks.createSystemAdmin).toHaveBeenCalledWith(expect.objectContaining({
      school_id: 20260001,
      organization_id: 8,
      email: 'maria@example.test',
      password: 'Initial-Password-123!',
      password_confirmation: 'Initial-Password-123!',
    })));
  });

  it('initiates a secure password reset after confirmation', async () => {
    render(<SystemAdminsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Initiate password reset for Ana Reyes/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(serviceMocks.initiateSystemAdminPasswordReset).toHaveBeenCalledWith(10101));
    expect(await screen.findByText('Password reset instructions were sent.')).toBeInTheDocument();
  });
});
