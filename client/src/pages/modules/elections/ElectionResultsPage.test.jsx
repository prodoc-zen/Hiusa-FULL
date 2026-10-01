import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ElectionResultsPage from './ElectionResultsPage';

const { getElectionResults, electionContext } = vi.hoisted(() => ({ getElectionResults: vi.fn(), electionContext: { election: { id: 5, title: 'Final Council Election', status: 'closed', finalized_at: '2026-09-01T08:00:00Z', results_visible: true }, role: 'STUDENT' } }));

vi.mock('../../../services/electionService', () => ({ getElectionResults }));
vi.mock('react-router-dom', () => ({
  useOutletContext: () => electionContext,
}));

describe('ElectionResultsPage', () => {
  it('shows winner spotlights and detailed vote bars', async () => {
    getElectionResults.mockResolvedValue([{
      position: { id: 1, title: 'President', max_winners: 1 },
      totalVotes: 40,
      candidates: [
        { id: 10, name: 'Ana Reyes', partylist: 'Forward', votes: 25 },
        { id: 11, name: 'Luis Cruz', partylist: 'Independent', votes: 15 },
      ],
    }]);

    render(<ElectionResultsPage />);
    expect(await screen.findByText('Winner spotlight')).toBeInTheDocument();
    expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
    expect(screen.getByText('63%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'President' })).toBeInTheDocument();
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
