import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddExistingUserModal from './AddExistingUserModal';

const mocks = vi.hoisted(() => ({ getProfileOrganizations: vi.fn(), inviteAccountProfile: vi.fn(), searchPeople: vi.fn() }));
vi.mock('../../services/authService', () => ({ getProfileOrganizations: mocks.getProfileOrganizations, inviteAccountProfile: mocks.inviteAccountProfile }));
vi.mock('../../services/peopleService', () => ({ searchPeople: mocks.searchPeople }));

const organization = { id: 8, name: 'Computing Council', college: 'College of Computer Studies' };
const maria = { school_id: 24001001, name: 'Maria Reyes', email: 'maria@example.test', program: 'BSIT', role: 'STUDENT', organizations: [] };

async function pickMaria() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Student' }), { target: { value: 'maria' } });
  fireEvent.click(await screen.findByRole('option', { name: /Maria Reyes/ }));
}

describe('AddExistingUserModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPeople.mockResolvedValue([maria]);
    mocks.getProfileOrganizations.mockResolvedValue({ data: [organization, { id: 9, name: 'Computing Club', parent_organization_id: 8, college: organization.college }] });
    mocks.inviteAccountProfile.mockResolvedValue({ data: { id: 41, organization_id: 8 } });
  });

  it('finds the student by name, never asks for a school ID, and submits the picked person', async () => {
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(<AddExistingUserModal organization={organization} actorRole="ADMIN" onClose={onClose} onAdded={onAdded} />);
    expect(screen.queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(screen.getByText('Students without an account sign up themselves with their school ID.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add student' })).toBeDisabled();
    await pickMaria();
    fireEvent.change(screen.getByLabelText('Role in this organization'), { target: { value: 'SBO_OFFICER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add student' }));
    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 24001001, organization_id: 8, role: 'SBO_OFFICER' }));
    expect(onAdded).toHaveBeenCalledWith({ id: 41, organization_id: 8 }, expect.objectContaining({ school_id: 24001001, name: 'Maria Reyes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([['ADMIN', 'college'], ['SUPER_ADMIN', 'all']])('searches with the right scope for %s', async (actorRole, scope) => {
    render(<AddExistingUserModal organization={organization} actorRole={actorRole} onClose={vi.fn()} />);
    await pickMaria();
    expect(mocks.searchPeople).toHaveBeenCalledWith({ q: 'maria', scope, exclude_organization_id: 8 });
  });

  it.each(['ADMIN', 'SUPER_ADMIN'])('lets %s assign the organization head role', async (actorRole) => {
    render(<AddExistingUserModal actorRole={actorRole} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Computing Club (Suborganization)' });
    fireEvent.change(screen.getByLabelText(/^Organization/), { target: { value: '9' } });
    await pickMaria();
    fireEvent.change(screen.getByLabelText('Role in this organization'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add student' }));
    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 24001001, organization_id: 9, role: 'ADMIN' }));
  });

  it.each(['SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT', null])('does not offer the head role to %s', (actorRole) => {
    render(<AddExistingUserModal actorRole={actorRole} organization={organization} onClose={vi.fn()} />);
    expect(screen.queryByRole('option', { name: 'Organization head' })).not.toBeInTheDocument();
  });

  it('starts with the person already chosen when opened from a row', () => {
    render(<AddExistingUserModal organization={organization} initialUser={{ school_id: 24001001, first_name: 'mARIA', last_name: 'rEYES', email: 'maria@example.test' }} onClose={vi.fn()} />);
    expect(screen.getByText('Maria Reyes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add student' })).toBeEnabled();
  });

  it('keeps the dialog open and shows the server reason when the add is refused', async () => {
    const onClose = vi.fn();
    mocks.inviteAccountProfile.mockRejectedValue({ response: { status: 422, data: { errors: { school_id: ['Choose a student from this college.'] } } } });
    render(<AddExistingUserModal organization={organization} actorRole="ADMIN" onClose={onClose} />);
    await pickMaria();
    fireEvent.click(screen.getByRole('button', { name: 'Add student' }));
    expect(await screen.findByText('Choose a student from this college.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets the person retry when the organizations fail to load', async () => {
    mocks.getProfileOrganizations.mockRejectedValueOnce(new Error('Offline'));
    render(<AddExistingUserModal actorRole="SUPER_ADMIN" onClose={vi.fn()} />);
    expect(await screen.findByText(/We could not load the organizations/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('option', { name: 'Computing Council' })).toBeInTheDocument();
  });
});
