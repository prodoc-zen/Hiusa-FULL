import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CastVotePage from './CastVotePage';
import { castVotes } from '../../../services/electionService';

const election = {
  id: 9,
  title: 'Student Council Election',
  status: 'active',
  phase: 'voting',
  open_round: 1,
  has_voted: false,
  my_ballot: null,
  approved_at: new Date(Date.now() - 120_000).toISOString(),
  finalized_at: new Date(Date.now() - 90_000).toISOString(),
  start_time: new Date(Date.now() - 60_000).toISOString(),
  end_time: new Date(Date.now() + 3_600_000).toISOString(),
  voters_count: 24,
  positions: [{ id: 1, title: 'President', max_winners: 1, vote_limit: null, is_active: true }],
  candidates: [{ id: 11, position_id: 1, platform: 'Transparent student services.', user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: { name: 'Forward' } }],
};

const senators = {
  ...election,
  positions: [{ id: 2, title: 'Senator', max_winners: 3, vote_limit: 2, is_active: true }],
  candidates: [
    { id: 21, position_id: 2, user: { first_name: 'Ben', last_name: 'Cruz' }, partylist: null },
    { id: 22, position_id: 2, user: { first_name: 'Cara', last_name: 'Dizon' }, partylist: null },
    { id: 23, position_id: 2, user: { first_name: 'Dan', last_name: 'Eala' }, partylist: null },
  ],
};

let shown = election;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useOutletContext: () => ({ election: shown, refreshElection: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../../services/electionService', () => ({ castVotes: vi.fn() }));

const start = () => fireEvent.click(screen.getByRole('button', { name: /Start my ballot/ }));
const next = () => fireEvent.click(screen.getByRole('button', { name: /Review ballot/ }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm and submit' }));

describe('CastVotePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ id: 100, role: 'STUDENT' }));
    shown = election;
  });

  it('presents a guided ballot overview and candidate selection workspace', () => {
    render(<CastVotePage />);
    expect(screen.getByRole('heading', { name: 'Student Council Election' })).toBeInTheDocument();
    expect(screen.getByText(/Choose your candidates, or skip any position/)).toBeInTheDocument();
    start();
    expect(screen.getByRole('heading', { name: 'President' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ana Reyes/ })).toBeInTheDocument();
    expect(screen.getByText('Transparent student services.')).toBeInTheDocument();
  });

  it('refuses on entry a member who joined after the ballot was finalized, without showing the steps', () => {
    shown = { ...election, ballot_refusal: 'You joined after the voter list was finalized, so you cannot vote in this election.' };
    render(<CastVotePage />);
    expect(screen.getByRole('heading', { name: 'You cannot vote in this election' })).toBeInTheDocument();
    expect(screen.getByText('You joined after the voter list was finalized, so you cannot vote in this election.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start my ballot/ })).not.toBeInTheDocument();
  });

  it('reviews the choices first and sends one entry per position with candidate_ids only after Confirm and submit', async () => {
    castVotes.mockResolvedValue({ success: true, receipt: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', election_title: 'Student Council Election', round: 1 });
    render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();

    expect(castVotes).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Review your ballot' })).toBeInTheDocument();
    expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
    confirm();

    await waitFor(() => expect(castVotes).toHaveBeenCalledTimes(1));
    expect(castVotes).toHaveBeenCalledWith(9, [{ position_id: 1, candidate_ids: [11] }]);
    expect(await screen.findByText('Ballot submitted')).toBeInTheDocument();
  });

  it('lets the voter skip a position and reads it as an abstention on the review', async () => {
    castVotes.mockResolvedValue({ success: true, receipt: 'BLANK-1', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 });
    render(<CastVotePage />);
    start();
    next();

    expect(screen.getByRole('heading', { name: 'Review your ballot' })).toBeInTheDocument();
    expect(screen.getAllByText('No selection (abstain)').length).toBeGreaterThan(0);
    expect(screen.queryByText('Complete all positions before final submission.')).not.toBeInTheDocument();
    confirm();

    await waitFor(() => expect(castVotes).toHaveBeenCalledWith(9, [{ position_id: 1, candidate_ids: [] }]));
    expect(await screen.findByText('Ballot submitted')).toBeInTheDocument();
    expect(screen.getAllByText('No selection (abstain)').length).toBeGreaterThan(0);
  });

  it('goes back from the review to the ballot with Back to edit and keeps the choice', () => {
    render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(screen.getByRole('heading', { name: 'President' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ana Reyes/, pressed: true })).toBeInTheDocument();
  });

  it('lets a voter choose up to the limit and refuses one more', async () => {
    shown = senators;
    castVotes.mockResolvedValue({ success: true, receipt: 'MULTI-1', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 });
    render(<CastVotePage />);
    start();

    expect(screen.getByText('Choose up to 2')).toBeInTheDocument();
    const ben = screen.getByRole('checkbox', { name: /Ben Cruz/ });
    const cara = screen.getByRole('checkbox', { name: /Cara Dizon/ });
    const dan = screen.getByRole('checkbox', { name: /Dan Eala/ });
    fireEvent.click(ben);
    fireEvent.click(cara);
    fireEvent.click(dan);
    expect(ben).toBeChecked();
    expect(cara).toBeChecked();
    expect(dan).not.toBeChecked();

    fireEvent.click(ben);
    expect(ben).not.toBeChecked();
    fireEvent.click(dan);
    expect(dan).toBeChecked();

    next();
    expect(screen.getAllByText('Cara Dizon').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dan Eala').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ben Cruz')).not.toBeInTheDocument();
    confirm();
    await waitFor(() => expect(castVotes).toHaveBeenCalledWith(9, [{ position_id: 2, candidate_ids: [22, 23] }]));
  });

  it('uses the number of seats as the limit when the position has no vote limit', () => {
    shown = { ...senators, positions: [{ id: 2, title: 'Senator', max_winners: 3, vote_limit: null, is_active: true }] };
    render(<CastVotePage />);
    start();
    expect(screen.getByText('Choose up to 3')).toBeInTheDocument();
  });

  it('shows only active positions that have candidates', () => {
    shown = {
      ...election,
      positions: [
        { id: 1, title: 'President', max_winners: 1, is_active: true },
        { id: 3, title: 'Treasurer', max_winners: 1, is_active: false },
        { id: 4, title: 'Auditor', max_winners: 1, is_active: true },
      ],
      candidates: [
        election.candidates[0],
        { id: 31, position_id: 3, user: { first_name: 'Eve', last_name: 'Fox' } },
      ],
    };
    render(<CastVotePage />);
    start();
    expect(screen.getByText(/Position 1 of 1/)).toBeInTheDocument();
    expect(screen.queryByText('Treasurer')).not.toBeInTheDocument();
    expect(screen.queryByText('Auditor')).not.toBeInTheDocument();
  });

  it('tells the voter what happens after the receipt', async () => {
    castVotes.mockResolvedValue({ success: true, receipt: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 });
    render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();
    confirm();

    expect(await screen.findByText('SAFE-RECEIPT')).toBeInTheDocument();
    expect(screen.getByText('What happens next')).toBeInTheDocument();
    expect(screen.getByText(/Results appear there once voting closes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Vote' })).toBeInTheDocument();
  });

  it('shows the election, the receipt, the Manila submission time and the choices from the page state', async () => {
    castVotes.mockResolvedValue({ success: true, receipt: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', election_title: 'Student Council Election', round: 1 });
    render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();
    confirm();

    expect(await screen.findByText('Ballot submitted')).toBeInTheDocument();
    expect(screen.getByText('Student Council Election')).toBeInTheDocument();
    expect(screen.getByText('SAFE-RECEIPT')).toBeInTheDocument();
    expect(screen.getByText(/^Submitted November 13, 2026.*5:30/i)).toBeInTheDocument();
    expect(screen.getAllByText('Ana Reyes').length).toBeGreaterThan(0);
  });

  it('prefers the time the server recorded once the election is refreshed', async () => {
    castVotes.mockResolvedValue({ success: true, receipt: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 });
    const { rerender } = render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();
    confirm();
    await screen.findByText('Ballot submitted');

    shown = { ...election, has_voted: true, my_ballot: { receipt_ref: 'SAFE-RECEIPT', submitted_at: '2026-11-14T02:15:00.000Z', round: 1 } };
    rerender(<CastVotePage />);

    expect(screen.getByText(/^Submitted November 14, 2026.*10:15/i)).toBeInTheDocument();
  });

  it('says turnout shows during voting and results appear when the election closes when the results are marked visible', async () => {
    shown = { ...election, results_visible: true };
    castVotes.mockResolvedValue({ success: true, receipt: 'SAFE-RECEIPT', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 });
    render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();
    confirm();

    expect(await screen.findByText(/Turnout is shown during voting, and results appear when the election closes/)).toBeInTheDocument();
    expect(screen.queryByText(/Results appear there once voting closes/)).not.toBeInTheDocument();
  });

  it('shows Vote already recorded with the receipt and time but no choices to a voter who already voted', () => {
    shown = { ...election, has_voted: true, my_ballot: { receipt_ref: 'RCPT-77', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 } };
    render(<CastVotePage />);
    expect(screen.getByRole('heading', { name: 'Vote already recorded' })).toBeInTheDocument();
    expect(screen.getByText('RCPT-77')).toBeInTheDocument();
    expect(screen.getByText(/November 13, 2026.*5:30/i)).toBeInTheDocument();
    expect(screen.queryByText('Ana Reyes')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start my ballot/ })).not.toBeInTheDocument();
  });

  it('keeps the already-voted message when the server refuses a second ballot', async () => {
    castVotes.mockRejectedValue({ response: { status: 409, data: { message: 'You have already voted in this election.' } } });
    render(<CastVotePage />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    next();
    confirm();

    expect(await screen.findByText('Vote already recorded')).toBeInTheDocument();
    expect(screen.getByText('Each voter can submit one ballot for this election.')).toBeInTheDocument();
    expect(screen.queryByText('What happens next')).not.toBeInTheDocument();
  });

  it('still reads an older payload without has_voted from my_votes', () => {
    const older = Object.fromEntries(Object.entries(election).filter(([key]) => !['has_voted', 'my_ballot', 'open_round', 'phase'].includes(key)));
    shown = { ...older, my_votes: [{ position_id: 1, candidate_id: 11, vote_hash: 'OLD-HASH' }] };
    render(<CastVotePage />);
    expect(screen.getByRole('heading', { name: 'Vote already recorded' })).toBeInTheDocument();
    expect(screen.getByText('OLD-HASH')).toBeInTheDocument();
  });

  it('shows no ballot when the server says no round is open', () => {
    shown = { ...election, open_round: null };
    render(<CastVotePage />);
    expect(screen.getByRole('heading', { name: 'No election is currently open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start my ballot/ })).not.toBeInTheDocument();
  });

  describe('runoff (round 2)', () => {
    const runoff = {
      ...election,
      phase: 'runoff',
      open_round: 2,
      start_time: new Date(Date.now() - 7_200_000).toISOString(),
      end_time: new Date(Date.now() - 3_600_000).toISOString(),
      positions: [
        { id: 1, title: 'President', max_winners: 1, is_active: true, runoff_candidate_ids: [11, 12], runoff_seats: 1 },
        { id: 5, title: 'Secretary', max_winners: 1, is_active: true, runoff_candidate_ids: null, runoff_seats: null },
      ],
      candidates: [
        { id: 11, position_id: 1, user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: null },
        { id: 12, position_id: 1, user: { first_name: 'Ben', last_name: 'Cruz' }, partylist: null },
        { id: 13, position_id: 1, user: { first_name: 'Cara', last_name: 'Dizon' }, partylist: null },
        { id: 51, position_id: 5, user: { first_name: 'Dan', last_name: 'Eala' }, partylist: null },
      ],
    };

    it('says Runoff vote and lists only the tied candidates of the positions in the runoff', async () => {
      shown = runoff;
      castVotes.mockResolvedValue({ success: true, receipt: 'RUN-1', submitted_at: '2026-11-13T09:30:00.000Z', round: 2 });
      render(<CastVotePage />);
      expect(screen.getByRole('heading', { name: 'Runoff vote' })).toBeInTheDocument();
      start();

      expect(screen.getByText(/Position 1 of 1/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ana Reyes/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ben Cruz/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cara Dizon/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Secretary')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Ben Cruz/ }));
      next();
      confirm();
      await waitFor(() => expect(castVotes).toHaveBeenCalledWith(9, [{ position_id: 1, candidate_ids: [12] }]));
    });
  });
});
