import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageAccountProfilesModal from './ManageAccountProfilesModal';

const mocks = vi.hoisted(() => ({ getManagedAccountProfiles: vi.fn(), deleteAccountProfile: vi.fn() }));
vi.mock('../../services/authService', () => mocks);
const organization = { id: 8, name: 'Computing Council' };
const profile = { id: 4, school_id: 24001001, first_name: 'Maria', last_name: 'Reyes', organization, role: 'STUDENT', account_status: 'active', is_primary: true, profiles_count: 2 };
const envelope = (rows, extra = {}) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, ...extra } });

describe('ManageAccountProfilesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([profile]));
    mocks.deleteAccountProfile.mockResolvedValue({ data: { account_deleted: false, remaining_profiles: 1, message: 'Organization profile deleted.' } });
  });

  it('requires confirmation, deletes the selected profile, and reloads remaining memberships', async () => {
    const onDeleted = vi.fn();
    render(<ManageAccountProfilesModal organization={organization} onClose={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete profile for/ }));
    expect(screen.getByText(/retains their other profiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete profile', exact: true })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: String(profile.school_id) } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile', exact: true }));
    await waitFor(() => expect(mocks.deleteAccountProfile).toHaveBeenCalledWith(4));
    await waitFor(() => expect(mocks.getManagedAccountProfiles).toHaveBeenCalledTimes(2));
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ account_deleted: false }));
  });

  it('warns when deleting the final profile and reports a linked-record conflict without closing', async () => {
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([{ ...profile, profiles_count: 1 }]));
    mocks.deleteAccountProfile.mockRejectedValue({ response: { data: { message: 'Linked financial records prevent deletion.' } } });
    const onClose = vi.fn();
    render(<ManageAccountProfilesModal user={profile} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete profile for/ }));
    expect(screen.getByText(/also permanently deletes the user account/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: String(profile.school_id) } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Linked financial records prevent deletion.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('searches only the specified user and organization and supports pagination', async () => {
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([profile], { last_page: 2 }));
    render(<ManageAccountProfilesModal organization={organization} user={profile} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: /Delete profile for/ });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.getManagedAccountProfiles).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.change(screen.getByLabelText('Search profiles'), { target: { value: 'maria' } });
    await waitFor(() => expect(mocks.getManagedAccountProfiles).toHaveBeenCalledWith({ organization_id: 8, user_school_id: 24001001, search: 'maria', page: 1, per_page: 20 }));
  });

  it('disables protected profiles and retries failed list requests', async () => {
    mocks.getManagedAccountProfiles.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(envelope([{ ...profile, deletion_block_reason: 'You cannot delete your own profile.' }]));
    render(<ManageAccountProfilesModal onClose={vi.fn()} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Delete profile for/ })).toBeDisabled();
    expect(screen.getByText('You cannot delete your own profile.')).toBeInTheDocument();
  });
});
