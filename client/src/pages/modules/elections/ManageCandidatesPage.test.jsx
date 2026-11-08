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

  it('shows no Add candidate button once the ballot is locked', async () => {
    outlet.election.finalized_at = '2026-09-01T08:00:00Z';
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(screen.queryByRole('button', { name: 'Add candidate' })).not.toBeInTheDocument();
    expect(screen.getByText(/Candidate setup is locked/)).toBeInTheDocument();
    outlet.election.finalized_at = null;
  });
});
