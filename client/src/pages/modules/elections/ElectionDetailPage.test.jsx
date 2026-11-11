import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionDetailPage from './ElectionDetailPage';

const { getElectionVoters, createElectionPosition, outlet } = vi.hoisted(() => ({
  getElectionVoters: vi.fn(),
  createElectionPosition: vi.fn(),
  outlet: { election: { id: 5, title: 'Council Election', status: 'active', finalized_at: '2026-09-01T08:00:00Z', positions: [{ id: 1, title: 'President', max_winners: 1 }], candidates: [], votes: [] }, refreshElection: vi.fn() },
}));

vi.mock('../../../services/electionService', () => ({ getElectionVoters, createElectionPosition, deleteElectionPosition: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useOutletContext: () => outlet }));

describe('ElectionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getElectionVoters.mockResolvedValue({ data: [{ school_id: '2024-1', first_name: 'Ana', last_name: 'Reyes', role: 'STUDENT', email: 'ana@example.com', has_voted: true }], per_page: 10, summary: { eligible_total: 4, voted_count: 1, turnout_percent: 25 } });
  });

  it('shows the ballot setup on the overview', () => {
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5']}><ElectionDetailPage /></MemoryRouter>);
    expect(screen.getByText('President')).toBeInTheDocument();
    expect(getElectionVoters).not.toHaveBeenCalled();
  });

  it('shows turnout only while voting is open, with no per candidate count', () => {
    const before = outlet.election;
    outlet.election = { ...before, voters_count: 9, candidates: [{ id: 3, position_id: 1, user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: { name: 'Forward' } }] };
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5']}><ElectionDetailPage /></MemoryRouter>);
    expect(screen.getByText(/ballots/)).toHaveTextContent('9 ballots');
    expect(screen.queryByText(/votes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Votes' })).not.toBeInTheDocument();
    expect(screen.getByText('Counts appear when voting closes.')).toBeInTheDocument();
    outlet.election = before;
  });

  it('shows each candidate count from the server once voting is closed', () => {
    const before = outlet.election;
    outlet.election = { ...before, status: 'closed', voters_count: 9, vote_counts: { 3: 7 }, candidates: [{ id: 3, position_id: 1, user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: { name: 'Forward' } }] };
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5']}><ElectionDetailPage /></MemoryRouter>);
    expect(screen.getByRole('columnheader', { name: 'Votes' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '7' })).toBeInTheDocument();
    expect(screen.queryByText('Counts appear when voting closes.')).not.toBeInTheDocument();
    outlet.election = before;
  });

  it('adds a position from the drawer on an unlocked ballot, with maximum winners marked optional', async () => {
    createElectionPosition.mockResolvedValue({ id: 2, title: 'Treasurer', max_winners: 1 });
    outlet.election.finalized_at = null;
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5']}><ElectionDetailPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add election position' });
    expect(within(dialog).getByText('(optional)')).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Add position' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Position title'), { target: { value: 'Treasurer' } });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(createElectionPosition).toHaveBeenCalledWith(5, { title: 'Treasurer', max_winners: 1 }));
    outlet.election.finalized_at = '2026-09-01T08:00:00Z';
  });

  it('shows read only turnout on the voters view for the Admin', async () => {
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5&view=voters']}><ElectionDetailPage /></MemoryRouter>);
    expect(await screen.findByText(/25% turnout/)).toBeInTheDocument();
    expect(getElectionVoters).toHaveBeenCalledWith(5, { page: 1 });
    expect(screen.queryByRole('button', { name: 'Add position' })).not.toBeInTheDocument();
  });
});
