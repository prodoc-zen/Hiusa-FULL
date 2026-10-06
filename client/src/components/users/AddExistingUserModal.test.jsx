import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddExistingUserModal from './AddExistingUserModal';

const mocks = vi.hoisted(() => ({ getProfileCandidates: vi.fn(), getProfileOrganizations: vi.fn(), inviteAccountProfile: vi.fn() }));
vi.mock('../../services/authService', () => mocks);
const organization = { id: 8, name: 'Computing Council', college: 'College of Computer Studies' };
const user = { school_id: 24001001, first_name: 'mARIA', last_name: 'rEYES', email: 'maria@example.test' };
const envelope = (data, extra = {}) => ({ data: { data, current_page: 1, last_page: 1, total: data.length, ...extra } });

describe('AddExistingUserModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileCandidates.mockResolvedValue(envelope([user]));
    mocks.getProfileOrganizations.mockResolvedValue({ data: [organization, { id: 9, name: 'Computing Club', parent_organization_id: 8, college: organization.college }] });
    mocks.inviteAccountProfile.mockResolvedValue({ data: { id: 41, organization_id: 8 } });
  });

  it('requires selecting a user and submits the destination and independent role', async () => {
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(<AddExistingUserModal organization={organization} onClose={onClose} onAdded={onAdded} />);
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('radio', { name: /Maria Reyes/ }));
    fireEvent.change(screen.getByLabelText('Role in destination organization'), { target: { value: 'SBO_OFFICER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 24001001, organization_id: 8, role: 'SBO_OFFICER' }));
    expect(onAdded).toHaveBeenCalledWith({ id: 41, organization_id: 8 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('searches by typed text within the selected organization and clears the previous selection', async () => {
    render(<AddExistingUserModal organization={organization} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Maria Reyes/ }));
    fireEvent.change(screen.getByLabelText('Search existing users'), { target: { value: 'maria@example.test' } });
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled();
    await waitFor(() => expect(mocks.getProfileCandidates).toHaveBeenCalledWith({ organization_id: 8, search: 'maria@example.test', page: 1, per_page: 20 }));
    expect(await screen.findByRole('radio', { name: /Maria Reyes/ })).not.toBeChecked();
  });

  it('lets SAO assign an Admin profile to an existing user in a suborganization', async () => {
    render(<AddExistingUserModal actorRole="SUPER_ADMIN" initialUser={user} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Computing Club (Suborganization)' });
    fireEvent.change(screen.getByLabelText('Destination organization'), { target: { value: '9' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Maria Reyes/ }));
    fireEvent.change(screen.getByLabelText('Role in destination organization'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: user.school_id, organization_id: 9, role: 'ADMIN' }));
  });

  it.each(['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT', null])('does not offer Admin assignment for actor %s', async (actorRole) => {
    render(<AddExistingUserModal actorRole={actorRole} organization={organization} onClose={vi.fn()} />);
    await screen.findByRole('radio', { name: /Maria Reyes/ });
    expect(screen.queryByRole('option', { name: 'Admin', exact: true })).not.toBeInTheDocument();
  });

  it('loads authorized destinations and prefilters a user from the action menu by school ID', async () => {
    render(<AddExistingUserModal initialUser={user} onClose={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Computing Club (Suborganization)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Destination organization'), { target: { value: '9' } });
    await screen.findByRole('radio', { name: /Maria Reyes/ });
    expect(mocks.getProfileCandidates).toHaveBeenCalledWith({ organization_id: 9, search: '24001001', page: 1, per_page: 20 });
    expect(screen.getByText(/College:/)).toHaveTextContent(organization.college);
  });

  it('supports pagination without carrying a selection to another page', async () => {
    mocks.getProfileCandidates.mockResolvedValue(envelope([user], { last_page: 2, total: 21 }));
    render(<AddExistingUserModal organization={organization} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Maria Reyes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.getProfileCandidates).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled();
  });

  it('ignores old results after switching destination colleges', async () => {
    let resolveOld;
    mocks.getProfileCandidates.mockImplementation(({ organization_id }) => organization_id === 8
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(envelope([{ ...user, school_id: 24001002, first_name: 'Ana', last_name: 'Cruz' }])));
    render(<AddExistingUserModal onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Computing Council' });
    fireEvent.change(screen.getByLabelText('Destination organization'), { target: { value: '8' } });
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Destination organization'), { target: { value: '9' } });
    await screen.findByRole('radio', { name: /Ana Cruz/ });
    await act(async () => resolveOld(envelope([user])));
    expect(screen.queryByRole('radio', { name: /Maria Reyes/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ana Cruz/ })).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the backend college validation failure', async () => {
    const onClose = vi.fn();
    mocks.inviteAccountProfile.mockRejectedValue({ response: { status: 422, data: { errors: { school_id: ['Choose a user from this college.'] } } } });
    render(<AddExistingUserModal organization={organization} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Maria Reyes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a user from this college.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an empty state and allows retrying a failed candidate search', async () => {
    mocks.getProfileCandidates.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(envelope([]));
    render(<AddExistingUserModal organization={organization} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to find existing users.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No eligible users found in this college.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled();
  });
});
