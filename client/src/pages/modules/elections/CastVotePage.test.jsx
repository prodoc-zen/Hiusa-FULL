import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CastVotePage from './CastVotePage';
import { castVotes } from '../../../services/electionService';

const election = {
  id: 9,
  title: 'Student Council Election',
  status: 'active',
  start_time: new Date(Date.now() - 60_000).toISOString(),
  end_time: new Date(Date.now() + 3_600_000).toISOString(),
  voters_count: 24,
  my_votes: [],
  positions: [{ id: 1, title: 'President', max_winners: 1 }],
  candidates: [{ id: 11, position_id: 1, platform: 'Transparent student services.', user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: { name: 'Forward' } }],
};

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useOutletContext: () => ({ election, refreshElection: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../../services/electionService', () => ({ castVotes: vi.fn() }));

describe('CastVotePage', () => {
  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify({ id: 100, role: 'STUDENT' }));
  });

  it('presents a guided ballot overview and candidate selection workspace', () => {
    render(<CastVotePage />);
    expect(screen.getByRole('heading', { name: 'Student Council Election' })).toBeInTheDocument();
    expect(screen.getByText('Review candidates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start my ballot/ }));
    expect(screen.getByRole('heading', { name: 'President' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ana Reyes/ })).toBeInTheDocument();
    expect(screen.getByText('Transparent student services.')).toBeInTheDocument();
  });

  it('requires an explicit final confirmation before submitting the ballot', async () => {
    castVotes.mockResolvedValue({ receipt: 'SAFE-RECEIPT' });
    render(<CastVotePage />);
    fireEvent.click(screen.getByRole('button', { name: /Start my ballot/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    fireEvent.click(screen.getByRole('button', { name: /Review ballot/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit final ballot/ }));

    expect(castVotes).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Submit your final ballot?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and submit' }));

    await waitFor(() => expect(castVotes).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Ballot submitted')).toBeInTheDocument();
  });
});
