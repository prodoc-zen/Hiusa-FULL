import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ElectionResultsPage from './ElectionResultsPage';

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
    expect(screen.getByRole('heading', { name: 'President' })).toBeInTheDocument();
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

  it('does not request unreleased results', () => {
    getElectionResults.mockClear();
    electionContext.election.results_visible = false;
    render(<ElectionResultsPage />);
    expect(screen.getByText('Election results are not available yet.')).toBeInTheDocument();
    expect(getElectionResults).not.toHaveBeenCalled();
    electionContext.election.results_visible = true;
  });
});
