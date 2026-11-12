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
  phase: 'voting',
  open_round: 1,
  has_voted: false,
  my_ballot: null,
  positions: [{ id: 1, title: 'President', max_winners: 1, is_active: true }],
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
      .mockResolvedValue({ ...election, has_voted: true, my_ballot: { receipt_ref: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 } });
    castVotes.mockResolvedValue({ success: true, receipt: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', election_title: 'Student Council Election', round: 1 });
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

  it('shows the receipt and no choices to a voter who opens the ballot after voting', async () => {
    getElectionDetails.mockResolvedValue({ ...election, has_voted: true, my_ballot: { receipt_ref: 'RCPT-5', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 } });
    renderBallot();
    expect(await screen.findByRole('heading', { name: 'Vote already recorded' })).toBeInTheDocument();
    expect(screen.getByText('RCPT-5')).toBeInTheDocument();
    expect(screen.queryByText('Ana Reyes')).not.toBeInTheDocument();
  });

  it('opens the runoff ballot while a runoff round is open even though the first voting window has passed', async () => {
    getElectionDetails.mockResolvedValue({
      ...election,
      phase: 'runoff',
      open_round: 2,
      end_time: new Date(Date.now() - 3_600_000).toISOString(),
      positions: [{ id: 1, title: 'President', max_winners: 1, is_active: true, runoff_candidate_ids: [11], runoff_seats: 1 }],
    });
    renderBallot();
    expect(await screen.findByRole('heading', { name: 'Runoff vote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start my ballot/ })).toBeInTheDocument();
  });

  it('shows no ballot when no round is open', async () => {
    getElectionDetails.mockResolvedValue({ ...election, open_round: null });
    renderBallot();
    expect(await screen.findByRole('heading', { name: 'No election is currently open' })).toBeInTheDocument();
  });
});
