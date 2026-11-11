import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageCandidatesPage from './ManageCandidatesPage';

const { getUsers, getPartylists, createElectionCandidate, outlet } = vi.hoisted(() => ({
  getUsers: vi.fn(),
  getPartylists: vi.fn(),
  createElectionCandidate: vi.fn(),
  outlet: {
    election: {
      id: 5,
      title: 'Council Election',
      status: 'upcoming',
      finalized_at: null,
      votes: [],
      positions: [{ id: 1, title: 'President', max_winners: 1 }, { id: 2, title: 'Treasurer', max_winners: 1 }],
      candidates: [{ id: 10, user_id: 301, position_id: 1, partylist_id: null, platform: 'Open books.', user: { first_name: 'Ana', last_name: 'Reyes' } }],
    },
    refreshElection: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/electionService', () => ({ getUsers, getPartylists, createElectionCandidate, deleteElectionCandidate: vi.fn(), updateElectionCandidate: vi.fn() }));
vi.mock('../../../services/pagination', () => ({ fetchAllPages: (fetchPage, params) => fetchPage(params).then((data) => data) }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useOutletContext: () => outlet }));

const students = [
  { id: 1, school_id: 301, role: 'STUDENT', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com' },
  { id: 2, school_id: 302, role: 'STUDENT', first_name: 'Luis', last_name: 'Cruz', email: 'luis@example.com' },
];

function renderPage() {
  return render(<MemoryRouter><ManageCandidatesPage /></MemoryRouter>);
}

describe('ManageCandidatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsers.mockResolvedValue(students);
    getPartylists.mockResolvedValue([]);
  });

  it('lists each candidate with a position and offers one Add candidate button', async () => {
    renderPage();
    expect((await screen.findAllByText('Ana Reyes')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Independent').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add candidate' })).toHaveLength(1);
  });

  it('adds a candidate by picking a student by name, with the optional fields marked', async () => {
    createElectionCandidate.mockResolvedValue({ id: 11 });
    renderPage();
    await screen.findAllByText('Ana Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'Add candidate' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add candidate' });
    expect(within(dialog).getByLabelText(/Party list/)).toBeInTheDocument();
    expect(within(dialog).getAllByText('(optional)')).toHaveLength(3);
    const submit = within(dialog).getByRole('button', { name: 'Add candidate' });
    expect(submit).toBeDisabled();

    const student = within(dialog).getByRole('combobox', { name: 'Student' });
    fireEvent.focus(student);
    fireEvent.change(student, { target: { value: 'Luis' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Luis Cruz/ }));
    fireEvent.change(within(dialog).getByLabelText('Position'), { target: { value: '2' } });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(createElectionCandidate).toHaveBeenCalledWith(5, expect.objectContaining({ user_id: 302, position_id: 2 })));
  });

  it('says beside the photo field when the chosen photo is over 2 MB and clears it when a smaller one is chosen', async () => {
    createElectionCandidate.mockResolvedValue({ id: 11 });
    renderPage();
    await screen.findAllByText('Ana Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'Add candidate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add candidate' });

    const photo = within(dialog).getByLabelText(/Candidate photo/);
    const tooBig = new File([new Uint8Array(3 * 1024 * 1024)], 'face.jpg', { type: 'image/jpeg' });
    fireEvent.change(photo, { target: { files: [tooBig] } });

    expect(photo).toHaveAttribute('aria-invalid', 'true');
    expect(photo).toHaveAccessibleDescription('Candidate photo must be 2 MB or smaller.');

    const small = new File([new Uint8Array(1024)], 'face.jpg', { type: 'image/jpeg' });
    fireEvent.change(photo, { target: { files: [small] } });
    expect(photo).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps Add candidate disabled while the chosen photo is refused, so no candidate is saved without it', async () => {
    createElectionCandidate.mockResolvedValue({ id: 11 });
    renderPage();
    await screen.findAllByText('Ana Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'Add candidate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add candidate' });
    const submit = within(dialog).getByRole('button', { name: 'Add candidate' });
    const student = within(dialog).getByRole('combobox', { name: 'Student' });
    fireEvent.focus(student);
    fireEvent.change(student, { target: { value: 'Luis' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Luis Cruz/ }));
    fireEvent.change(within(dialog).getByLabelText('Position'), { target: { value: '2' } });
    await waitFor(() => expect(submit).toBeEnabled());

    const photo = within(dialog).getByLabelText(/Candidate photo/);
    fireEvent.change(photo, { target: { files: [new File([new Uint8Array(3 * 1024 * 1024)], 'face.jpg', { type: 'image/jpeg' })] } });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(createElectionCandidate).not.toHaveBeenCalled();

    fireEvent.change(photo, { target: { files: [new File([new Uint8Array(1024)], 'face.jpg', { type: 'image/jpeg' })] } });
    expect(submit).toBeEnabled();
  });

  it('asks for students and officers and lists an officer in the Add candidate list', async () => {
    getUsers.mockResolvedValue([...students, { id: 3, school_id: 303, role: 'SBO_OFFICER', first_name: 'Mara', last_name: 'Dizon', email: 'mara@example.com' }]);
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(getUsers).toHaveBeenCalledWith({ role: JSON.stringify(['STUDENT', 'SBO_OFFICER']), account_status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Add candidate' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add candidate' });
    const student = within(dialog).getByRole('combobox', { name: 'Student' });
    fireEvent.focus(student);
    fireEvent.change(student, { target: { value: 'Mara' } });
    expect(await within(dialog).findByRole('option', { name: /Mara Dizon/ })).toBeInTheDocument();
  });

  it('shows no Add candidate button once the ballot is locked', async () => {
    outlet.election.finalized_at = '2026-09-01T08:00:00Z';
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(screen.queryByRole('button', { name: 'Add candidate' })).not.toBeInTheDocument();
    expect(screen.getByText('Candidate setup is locked because the ballot has been finalized.')).toBeInTheDocument();
    expect(screen.queryByText(/votes have already been cast/)).not.toBeInTheDocument();
    outlet.election.finalized_at = null;
  });

  it('says votes were cast only when votes exist', async () => {
    outlet.election.votes = [{ id: 1 }];
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(screen.getByText('Candidate setup is locked because votes have already been cast.')).toBeInTheDocument();
    outlet.election.votes = [];
  });
});
