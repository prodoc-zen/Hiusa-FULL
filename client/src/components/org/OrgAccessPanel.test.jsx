import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgAccessPanel from './OrgAccessPanel';

const mocks = vi.hoisted(() => ({
  getManagedAccountProfiles: vi.fn(),
  deleteAccountProfile: vi.fn(),
  inviteAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
  getProfilePositions: vi.fn(),
  searchPeople: vi.fn(),
}));
vi.mock('../../services/authService', () => mocks);
vi.mock('../../services/peopleService', () => ({ searchPeople: mocks.searchPeople }));

const MARIA = { id: 11, school_id: 2100142, first_name: 'Maria', last_name: 'Santos', email: 'maria@example.edu', role: 'SBO_OFFICER', position_title: 'Secretary', modules: ['events', 'tasks'], profiles_count: 2, deletion_block_reason: null };
const JUAN = { id: 12, school_id: 2100143, first_name: 'Juan', last_name: 'Cruz', email: 'juan@example.edu', role: 'ADMIN', position_title: 'President', modules: null, profiles_count: 1, deletion_block_reason: null };
const ANA = { id: 13, school_id: 2100144, first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.edu', role: 'STUDENT', position_title: null, modules: null, profiles_count: 1, deletion_block_reason: null };
const PICKED = { school_id: 2100150, name: 'Lia Ramos', email: 'lia@example.edu', program: 'BSIT', role: 'STUDENT', organizations: [] };
const envelope = (data) => ({ data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } });

function renderPanel(props = {}) {
  return render(<MemoryRouter><OrgAccessPanel organizationId={5} actorRole="DEPARTMENT_HEAD" {...props} /></MemoryRouter>);
}

const seen = (name) => screen.findAllByText(name);

async function pickPerson() {
  fireEvent.change(screen.getByRole('combobox', { name: /student/i }), { target: { value: 'lia' } });
  fireEvent.click(await screen.findByRole('option', { name: /Lia Ramos/ }));
}

describe('OrgAccessPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([MARIA, JUAN, ANA]));
    mocks.getProfilePositions.mockResolvedValue({ data: [
      { id: 1, role: 'ADMIN', title: 'President' },
      { id: 2, role: 'SBO_OFFICER', title: 'Secretary' },
      { id: 3, role: 'SBO_OFFICER', title: 'Treasurer' },
    ] });
    mocks.searchPeople.mockResolvedValue([PICKED]);
    mocks.inviteAccountProfile.mockResolvedValue({ data: { id: 40 } });
    mocks.updateAccountProfile.mockResolvedValue({ data: { id: 11 } });
    mocks.deleteAccountProfile.mockResolvedValue({ data: {} });
  });

  it('shows name first with email and school ID as small text, plus position, access and modules', async () => {
    renderPanel();

    expect(await seen('Maria Santos')).not.toHaveLength(0);
    expect(screen.getAllByText('maria@example.edu · 2100142').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Secretary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Officer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Organization head').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Events, Tasks').length).toBeGreaterThan(0);
    expect(mocks.getManagedAccountProfiles).toHaveBeenCalledWith({ organization_id: 5, per_page: 20, page: 1 });
  });

  it('shows only the email for an internal account number', async () => {
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([{ ...JUAN, school_id: 95000002 }]));
    renderPanel();

    expect(await screen.findAllByText('juan@example.edu')).not.toHaveLength(0);
    expect(screen.queryByText(/95000002/)).not.toBeInTheDocument();
  });

  it('shows a plain empty state and offers to give access', async () => {
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([]));
    renderPanel();

    expect(await screen.findByText('No one has access yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Give access/ })).toBeInTheDocument();
  });

  it('shows an error with a retry that loads the list again', async () => {
    mocks.getManagedAccountProfiles.mockRejectedValueOnce({ response: { data: { message: 'Server is busy.' } } });
    renderPanel();

    expect(await screen.findByText('Server is busy.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await seen('Maria Santos')).not.toHaveLength(0);
  });

  it('searches the list after a short pause', async () => {
    renderPanel();
    await seen('Maria Santos');

    fireEvent.change(screen.getByLabelText('Search people with access'), { target: { value: 'maria' } });

    await waitFor(() => expect(mocks.getManagedAccountProfiles).toHaveBeenLastCalledWith({ organization_id: 5, per_page: 20, page: 1, search: 'maria' }));
  });

  it('lets the dean give an officer access with some modules unticked', async () => {
    renderPanel();
    await seen('Maria Santos');

    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    const dialog = await screen.findByRole('dialog');
    await pickPerson();
    fireEvent.change(within(dialog).getByLabelText('Access level'), { target: { value: 'SBO_OFFICER' } });
    fireEvent.change(within(dialog).getByLabelText(/^Position/), { target: { value: 'Treasurer' } });
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(8);
    within(dialog).getAllByRole('checkbox').forEach((box) => expect(box).toBeChecked());
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Finance' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Elections' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));

    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({
      school_id: 2100150,
      organization_id: 5,
      role: 'SBO_OFFICER',
      position_title: 'Treasurer',
      modules: ['members', 'events', 'tasks', 'merchandise', 'compliance', 'announcements'],
    }));
    expect(await screen.findByText('Lia Ramos now has access.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getManagedAccountProfiles.mock.calls.length).toBeGreaterThan(1));
  });

  it('searches the college by name or email, never by typing a school ID field', async () => {
    renderPanel();
    await seen('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    await screen.findByRole('dialog');

    await pickPerson();

    expect(mocks.searchPeople).toHaveBeenCalledWith({ q: 'lia', scope: 'college', role: 'STUDENT' });
    expect(screen.queryByLabelText(/school id/i)).not.toBeInTheDocument();
  });

  it('hides modules and position when the access level is Member', async () => {
    renderPanel();
    await seen('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    const dialog = await screen.findByRole('dialog');
    await pickPerson();

    fireEvent.change(within(dialog).getByLabelText('Access level'), { target: { value: 'STUDENT' } });

    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(dialog).queryByLabelText(/^Position/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));
    await waitFor(() => expect(mocks.inviteAccountProfile).toHaveBeenCalledWith({ school_id: 2100150, organization_id: 5, role: 'STUDENT', position_title: null }));
  });

  it('only offers the positions that belong to the chosen level', async () => {
    renderPanel();
    await seen('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(mocks.getProfilePositions).toHaveBeenCalledWith(5));

    fireEvent.change(within(dialog).getByLabelText('Access level'), { target: { value: 'ADMIN' } });

    const options = Array.from(within(dialog).getByLabelText(/^Position/).querySelectorAll('option')).map((option) => option.textContent);
    expect(options).toEqual(['No position', 'President']);
  });

  it('does not let an organization head hand out their own level', async () => {
    renderPanel({ actorRole: 'ADMIN' });
    await seen('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    const dialog = await screen.findByRole('dialog');

    const levels = Array.from(within(dialog).getByLabelText('Access level').querySelectorAll('option')).map((option) => option.textContent);

    expect(levels).toEqual(['Officer', 'Member']);
  });

  it('will not save an officer with nothing ticked', async () => {
    renderPanel();
    await seen('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    const dialog = await screen.findByRole('dialog');
    await pickPerson();

    within(dialog).getAllByRole('checkbox').forEach((box) => fireEvent.click(box));

    expect(within(dialog).getByText('Pick at least one.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Give access' })).toBeDisabled();
  });

  it('shows the server message when giving access fails', async () => {
    mocks.inviteAccountProfile.mockRejectedValue({ response: { data: { message: 'This account already belongs to the organization.' } } });
    renderPanel();
    await seen('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /Give access/ }));
    const dialog = await screen.findByRole('dialog');
    await pickPerson();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This account already belongs to the organization.');
  });

  it('changes an officer\'s modules without asking for the person again', async () => {
    renderPanel();
    await seen('Maria Santos');

    fireEvent.click(screen.getAllByRole('button', { name: 'Change access for Maria Santos' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('maria@example.edu')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Events' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Finance' })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Finance' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledWith(11, {
      role: 'SBO_OFFICER', position_title: 'Secretary', modules: ['events', 'finance', 'tasks'],
    }));
    expect(await screen.findByText('Access updated for Maria Santos.')).toBeInTheDocument();
  });

  it('asks before removing access and reports it', async () => {
    renderPanel();
    await seen('Maria Santos');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Maria Santos' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('They lose access to this organization only.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));

    await waitFor(() => expect(mocks.deleteAccountProfile).toHaveBeenCalledWith(11));
    expect(await screen.findByText('Maria Santos no longer has access.')).toBeInTheDocument();
  });

  it('warns when removing the only profile would delete the account', async () => {
    renderPanel();
    await seen('Ana Reyes');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Ana Reyes' })[0]);

    expect(await screen.findByRole('dialog')).toHaveTextContent('deletes the account');
  });

  it('disables actions the server will refuse and says why', async () => {
    mocks.getManagedAccountProfiles.mockResolvedValue(envelope([{ ...JUAN, deletion_block_reason: 'Only the dean or SAO can change or remove an Admin profile.' }]));
    renderPanel({ actorRole: 'ADMIN' });

    const buttons = await screen.findAllByRole('button', { name: 'Remove Juan Cruz' });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveAttribute('title', 'Only the dean or SAO can change or remove an Admin profile.');
  });

  it('shows the list but no way to give access to someone who cannot grant', async () => {
    renderPanel({ actorRole: 'SBO_OFFICER' });

    expect(await seen('Maria Santos')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Give access/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Maria Santos/ })).not.toBeInTheDocument();
  });
});
