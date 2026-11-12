import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ElectionResultsPage from './ElectionResultsPage';
import { PERIOD_KEY } from '../../../utils/academicPeriodStore';

const { getElectionResults, getElections, electionContext } = vi.hoisted(() => ({ getElectionResults: vi.fn(), getElections: vi.fn().mockResolvedValue([]), electionContext: { election: { id: 5, title: 'Final Council Election', status: 'closed', finalized_at: '2026-09-01T08:00:00Z', results_visible: true, voters_count: 30 }, role: 'STUDENT' } }));

vi.mock('../../../services/electionService', () => ({ getElectionResults, getElections }));
vi.mock('react-router-dom', () => ({
  useOutletContext: () => electionContext,
}));

describe('ElectionResultsPage', () => {
  it('lists the winners and the vote share of every candidate', async () => {
    getElectionResults.mockResolvedValue([{
      position: { id: 1, title: 'President', max_winners: 1 },
      totalVotes: 40,
      candidates: [
        { id: 10, name: 'Ana Reyes', partylist: 'Forward', votes: 25 },
        { id: 11, name: 'Luis Cruz', partylist: 'Independent', votes: 15 },
      ],
    }]);

    render(<ElectionResultsPage />);
    expect(await screen.findByRole('heading', { name: 'Winners' })).toBeInTheDocument();
    expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('63%').length).toBeGreaterThan(0);
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('Votes cast')).toBeInTheDocument();
    expect(screen.getByText(/votes cast/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'President' })).toBeInTheDocument();
  });

  it('lists the elections of the closed semester a student chose in the top bar', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify({ id: 2, number: 2, status: 'completed', academic_year: { label: '2025-2026' } }));
    getElectionResults.mockResolvedValue([]);
    getElections.mockClear();

    render(<ElectionResultsPage />);
    await waitFor(() => expect(getElections).toHaveBeenCalledWith({ academic_semester_id: 2 }));
    localStorage.removeItem(PERIOD_KEY);
  });

  it('says "1 vote cast" for a single vote and "votes cast" otherwise', async () => {
    getElectionResults.mockResolvedValue([
      { position: { id: 1, title: 'President', max_winners: 1 }, totalVotes: 1, candidates: [{ id: 10, name: 'Ana Reyes', partylist: 'Forward', votes: 1 }] },
      { position: { id: 2, title: 'Treasurer', max_winners: 1 }, totalVotes: 0, candidates: [{ id: 20, name: 'Mia Lopez', partylist: 'Forward', votes: 0 }] },
      { position: { id: 3, title: 'Auditor', max_winners: 1 }, totalVotes: 2, candidates: [{ id: 30, name: 'Rey Tan', partylist: 'Forward', votes: 2 }] },
    ]);

    render(<ElectionResultsPage />);
    expect(await screen.findByText(/^vote cast$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^votes cast$/)).toHaveLength(2);
  });

  it('shows that access was handed to the winners and flags a tie', async () => {
    getElectionResults.mockResolvedValue([
      { position: { id: 1, title: 'President', max_winners: 1 }, totalVotes: 40, winner_ids: [10], tie: false, access_handed_over: true, candidates: [{ id: 10, name: 'Ana Reyes', partylist: 'Forward', votes: 25 }, { id: 11, name: 'Luis Cruz', partylist: 'Independent', votes: 15 }] },
      { position: { id: 2, title: 'Treasurer', max_winners: 1 }, totalVotes: 6, winner_ids: [], tie: true, access_handed_over: false, candidates: [{ id: 20, name: 'Mia Lopez', partylist: 'Forward', votes: 3 }, { id: 21, name: 'Rey Tan', partylist: 'Independent', votes: 3 }] },
    ]);

    render(<ElectionResultsPage />);
    expect(await screen.findByText('Access handed over')).toBeInTheDocument();
    expect(screen.getAllByText('Tie, assign manually').length).toBeGreaterThan(0);
    expect(screen.getByText(/Treasurer is tied/)).toBeInTheDocument();
    const winners = screen.getByRole('table', { name: 'Final winners by position' });
    expect(within(winners).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(winners).queryByText('Mia Lopez')).not.toBeInTheDocument();
  });

  it('shows only turnout while voting is open and says results appear when the election closes', async () => {
    const closed = electionContext.election;
    electionContext.election = { ...closed, status: 'active', voters_count: 12 };
    getElectionResults.mockResolvedValue([{
      position: { id: 1, title: 'President', max_winners: 1 },
      totalVotes: null,
      candidates: [
        { id: 10, name: 'Ana Reyes', partylist: 'Forward', votes: null },
        { id: 11, name: 'Luis Cruz', partylist: 'Independent', votes: null },
      ],
    }]);

    render(<ElectionResultsPage />);
    expect(await screen.findByText(/Results appear when the election closes/)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Votes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.getByText('Ballots')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Votes cast')).not.toBeInTheDocument();
    expect(screen.queryByText(/votes cast/)).not.toBeInTheDocument();
    electionContext.election = closed;
  });

  it('does not request unreleased results', () => {
    getElectionResults.mockClear();
    electionContext.election.results_visible = false;
    render(<ElectionResultsPage />);
    expect(screen.getByText('Election results are not available yet.')).toBeInTheDocument();
    expect(getElectionResults).not.toHaveBeenCalled();
    electionContext.election.results_visible = true;
  });
});
