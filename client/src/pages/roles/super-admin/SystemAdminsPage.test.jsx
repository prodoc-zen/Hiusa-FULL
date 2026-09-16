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

  it('does not expose password fields when SAO creates an Admin', async () => {
    render(<SystemAdminsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New Admin User' }));

    expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument();
    expect(screen.getByText(/SAO cannot view or set it/i)).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Adviser"]')).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Organization Adviser"]')).not.toBeInTheDocument();
  });

  it('initiates a secure password reset after confirmation', async () => {
    render(<SystemAdminsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Initiate password reset for Ana Reyes/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(serviceMocks.initiateSystemAdminPasswordReset).toHaveBeenCalledWith(10101));
    expect(await screen.findByText('Password reset instructions were sent.')).toBeInTheDocument();
  });
});
