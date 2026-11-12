import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImmersiveVotePage from './ImmersiveVotePage';
import { castVotes, getElectionDetails } from '../../../services/electionService';

const election = {
  id: 9,
  title: 'Student Council Election',
  status: 'active',
  approved_at: new Date(Date.now() - 120_000).toISOString(),
  finalized_at: new Date(Date.now() - 90_000).toISOString(),
  start_time: new Date(Date.now() - 60_000).toISOString(),
  end_time: new Date(Date.now() + 3_600_000).toISOString(),
  voters_count: 24,
  my_votes: [],
  positions: [{ id: 1, title: 'President', max_winners: 1 }],
  candidates: [{ id: 11, position_id: 1, platform: 'Transparent student services.', user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: { name: 'Forward' } }],
};

vi.mock('../../../services/electionService', () => ({ castVotes: vi.fn(), getElectionDetails: vi.fn() }));

function VoteHub() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <p>Vote hub at {location.pathname}</p>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
    </div>
  );
}

function renderBallot() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/elections/home', '/dashboard/elections/cast-vote', '/elections/9/vote']} initialIndex={2}>
      <Routes>
        <Route path="/dashboard/elections/home" element={<p>Elections home</p>} />
        <Route path="/dashboard/elections/cast-vote" element={<VoteHub />} />
        <Route path="/elections/:electionId/vote" element={<ImmersiveVotePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function castBallot() {
  fireEvent.click(await screen.findByRole('button', { name: /Start my ballot/ }));
  fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
  fireEvent.click(screen.getByRole('button', { name: /Review ballot/ }));
  fireEvent.click(screen.getByRole('button', { name: /Submit final ballot/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and submit' }));
  await screen.findByText('Ballot submitted');
}

describe('ImmersiveVotePage history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ id: 100, role: 'STUDENT' }));
  });

  it('keeps the ballot in history after a cast vote so Back from Vote reaches the already-voted message', async () => {
    getElectionDetails
      .mockResolvedValueOnce(election)
      .mockResolvedValue({ ...election, my_votes: [{ position_id: 1, candidate_id: 11, vote_hash: 'SAFE-RECEIPT' }] });
    castVotes.mockResolvedValue({ receipt: 'SAFE-RECEIPT' });
    renderBallot();
    await castBallot();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Vote' }));
    expect(await screen.findByText('Vote hub at /dashboard/elections/cast-vote')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByRole('heading', { name: 'Vote already recorded' })).toBeInTheDocument();
  });

  it('does not put an unsubmitted ballot back in history when the voter exits it', async () => {
    getElectionDetails.mockResolvedValue(election);
    renderBallot();
    await screen.findByRole('button', { name: /Start my ballot/ });

    fireEvent.click(screen.getByRole('button', { name: /Exit ballot/ }));
    expect(await screen.findByText('Vote hub at /dashboard/elections/cast-vote')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() => expect(screen.getByText('Vote hub at /dashboard/elections/cast-vote')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Start my ballot/ })).not.toBeInTheDocument();
  });
});
