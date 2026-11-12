import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CastVoteRedirectPage from './CastVoteRedirectPage';
import { PERIOD_KEY } from '../../../utils/academicPeriodStore';

const { getElectionDetails, getElections } = vi.hoisted(() => ({ getElectionDetails: vi.fn(), getElections: vi.fn() }));
vi.mock('../../../services/electionService', () => ({ getElectionDetails, getElections }));

const HOUR = 3_600_000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();
const open = { status: 'active', finalized_at: iso(-3 * HOUR), start_time: iso(-HOUR), end_time: iso(HOUR), results_visible: false };

function renderPage() {
  localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
  return render(<MemoryRouter initialEntries={['/dashboard/elections/cast-vote']}><CastVoteRedirectPage /></MemoryRouter>);
}

function cardFor(title) {
  return screen.getByRole('heading', { name: title }).closest('article');
}

describe('CastVoteRedirectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels every election Open, Voted, Upcoming or Closed with text', async () => {
    const list = [
      { ...open, id: 1, title: 'Open Election' },
      { ...open, id: 2, title: 'Voted Election' },
      { id: 3, title: 'Upcoming Election', status: 'upcoming', finalized_at: iso(-HOUR), start_time: iso(2 * HOUR), end_time: iso(4 * HOUR) },
      { id: 4, title: 'Closed Election', status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), results_visible: true },
    ];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockImplementation(async (id) => ({ ...list.find((item) => item.id === id), my_votes: id === 2 ? [{ vote_hash: 'RECEIPT-123' }] : [] }));
    renderPage();

    await screen.findByText('Open Election');
    expect(within(cardFor('Open Election')).getByText('Open')).toBeInTheDocument();
    expect(within(cardFor('Voted Election')).getByText('Voted')).toBeInTheDocument();
    expect(within(cardFor('Upcoming Election')).getByText('Upcoming')).toBeInTheDocument();
    expect(within(cardFor('Closed Election')).getByText('Closed')).toBeInTheDocument();
  });

  it('lists the elections of the closed semester chosen in the top bar, none of them votable', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify({ id: 2, number: 2, status: 'completed', academic_year: { label: '2025-2026' } }));
    const list = [{ id: 4, title: 'Closed Election', status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), results_visible: true }];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockResolvedValue({ ...list[0], my_votes: [] });
    renderPage();

    await screen.findByText('Closed Election');
    expect(getElections).toHaveBeenCalledWith({ academic_semester_id: 2 });
    expect(within(cardFor('Closed Election')).queryByRole('link', { name: /vote/i })).not.toBeInTheDocument();
    localStorage.removeItem(PERIOD_KEY);
  });

  it('shows the receipt for an election already voted in, and offers the ballot only for open ones', async () => {
    const list = [{ ...open, id: 1, title: 'Election 1' }, { ...open, id: 2, title: 'Election 2' }];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockImplementation(async (id) => ({ ...list.find((item) => item.id === id), my_votes: id === 1 ? [{ vote_hash: 'RECEIPT-123' }] : [] }));
    renderPage();

    expect(await screen.findByText('RECEIPT-123')).toBeInTheDocument();
    expect(within(cardFor('Election 1')).queryByRole('link', { name: 'Vote in this election' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Vote in this election' })).toHaveLength(1);
    expect(within(cardFor('Election 2')).getByRole('link', { name: 'Vote in this election' })).toHaveAttribute('href', '/elections/2/vote');
  });

  it('says why instead of offering the ballot when the server would refuse the student', async () => {
    const list = [{ ...open, id: 1, title: 'Election 1' }];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockResolvedValue({ ...list[0], my_votes: [], ballot_refusal: 'You joined after the voter list was finalized, so you cannot vote in this election.' });
    renderPage();

    expect(await screen.findByText('You joined after the voter list was finalized, so you cannot vote in this election.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vote in this election' })).not.toBeInTheDocument();
  });

  it('reads Available when voting closes until the results are released, then links to them', async () => {
    const list = [
      { ...open, id: 1, title: 'Still Open' },
      { id: 2, title: 'Released', status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), results_visible: true },
    ];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockImplementation(async (id) => ({ ...list.find((item) => item.id === id), my_votes: id === 1 ? [{ vote_hash: 'H' }] : [] }));
    renderPage();

    await screen.findByText('Still Open');
    expect(within(cardFor('Still Open')).getByText('Available when voting closes')).toBeInTheDocument();
    expect(within(cardFor('Still Open')).queryByRole('link', { name: /results|totals/i })).not.toBeInTheDocument();
    expect(within(cardFor('Released')).getByRole('link', { name: 'View results' })).toHaveAttribute('href', '/dashboard/elections/election-results?record=2');
  });

  it('lists the open election first and leaves out an election still awaiting approval', async () => {
    const list = [
      { id: 1, title: 'Closed First', status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR) },
      { id: 2, title: 'Waiting On Approval', status: 'pending_approval', start_time: iso(HOUR), end_time: iso(2 * HOUR) },
      { ...open, id: 3, title: 'Open Last' },
    ];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockImplementation(async (id) => ({ ...list.find((item) => item.id === id), my_votes: [] }));
    renderPage();

    await screen.findByText('Open Last');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Open Last', 'Closed First']);
    expect(screen.queryByText('Waiting On Approval')).not.toBeInTheDocument();
  });

  it('asks for details only of elections the server will show a student, never an upcoming or unreleased one', async () => {
    const list = [
      { ...open, id: 1, title: 'Open Election' },
      { id: 2, title: 'Upcoming Election', status: 'upcoming', finalized_at: iso(-HOUR), start_time: iso(2 * HOUR), end_time: iso(4 * HOUR), results_visible: false },
      { id: 3, title: 'Unfinalized Election', status: 'upcoming', finalized_at: null, start_time: iso(2 * HOUR), end_time: iso(4 * HOUR), results_visible: false },
      { id: 4, title: 'Held Results', status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), results_visible: false },
      { id: 5, title: 'Released Results', status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), results_visible: true },
    ];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockImplementation(async (id) => ({ ...list.find((item) => item.id === id), my_votes: [] }));
    renderPage();

    await screen.findByText('Open Election');
    expect(getElectionDetails.mock.calls.map(([id]) => id)).toEqual([1, 5]);
    expect(within(cardFor('Upcoming Election')).getByText('Upcoming')).toBeInTheDocument();
    expect(within(cardFor('Upcoming Election')).getByText(/Voting opens/)).toBeInTheDocument();
    expect(within(cardFor('Unfinalized Election')).getByText(/still being built/)).toBeInTheDocument();
    expect(within(cardFor('Held Results')).getByText('Closed')).toBeInTheDocument();
  });

  it('still lists an election when its details cannot be loaded', async () => {
    getElections.mockResolvedValue([{ ...open, id: 1, title: 'Election 1' }]);
    getElectionDetails.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Election 1')).toBeInTheDocument();
  });

  it('writes the voting period as plain dates with both ends and no minute count', async () => {
    getElections.mockResolvedValue([{ id: 1, title: 'Fall Election', status: 'active', finalized_at: '2026-11-01T00:00:00Z', start_time: '2026-11-07T11:00:00Z', end_time: '2026-11-15T11:00:00Z', results_visible: false }]);
    getElectionDetails.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText('Nov 7 to Nov 15, 2026, 7:00 PM')).toBeInTheDocument();
    expect(screen.queryByText(/minutes/)).not.toBeInTheDocument();
  });

  it('gives each end its own time when voting opens and closes at different times', async () => {
    getElections.mockResolvedValue([{ id: 1, title: 'Fall Election', status: 'active', finalized_at: '2026-11-01T00:00:00Z', start_time: '2026-11-07T00:00:00Z', end_time: '2026-11-15T09:30:00Z', results_visible: false }]);
    getElectionDetails.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText('Nov 7, 8:00 AM to Nov 15, 2026, 5:30 PM')).toBeInTheDocument();
  });

  it('names the organization on each card, for a member who votes in more than one', async () => {
    const list = [
      { ...open, id: 1, title: 'Election of officers', organization: { id: 31, name: 'Rehearsal Society' } },
      { ...open, id: 2, title: 'Election of officers', organization: { id: 32, name: 'Chess Club' } },
    ];
    getElections.mockResolvedValue(list);
    getElectionDetails.mockImplementation(async (id) => ({ ...list.find((item) => item.id === id), my_votes: [] }));
    renderPage();

    await screen.findByText('Rehearsal Society');
    const [first, second] = screen.getAllByRole('article');
    expect(within(first).getByText('Rehearsal Society')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Vote in this election' })).toHaveAttribute('href', '/elections/1/vote');
    expect(within(second).getByText('Chess Club')).toBeInTheDocument();
    expect(within(second).getByRole('link', { name: 'Vote in this election' })).toHaveAttribute('href', '/elections/2/vote');
  });

  it('still lists an election that comes without an organization name', async () => {
    getElections.mockResolvedValue([{ ...open, id: 1, title: 'Election 1' }]);
    getElectionDetails.mockResolvedValue({ my_votes: [] });
    renderPage();
    expect(await screen.findByText('Election 1')).toBeInTheDocument();
    expect(screen.queryByText('Organization')).not.toBeInTheDocument();
  });

  it('names what to expect when no election is open', async () => {
    getElections.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No election is open for voting')).toBeInTheDocument();
    expect(screen.getByText(/Elections appear here when the Admin opens one/)).toBeInTheDocument();
  });

  describe('phase cards', () => {
    const phased = (id, title, phase, extra = {}) => ({ id, title, phase, status: 'upcoming', finalized_at: null, start_time: iso(10 * HOUR), end_time: iso(12 * HOUR), open_round: null, has_voted: false, my_ballot: null, filing_starts_at: iso(HOUR), results_visible: false, ...extra });

    it('says when filing opens for a scheduled election and offers no action', async () => {
      getElections.mockResolvedValue([phased(1, 'Scheduled Election', 'scheduled', { filing_starts_at: '2026-11-20T00:00:00Z' })]);
      renderPage();
      await screen.findByText('Scheduled Election');
      const card = cardFor('Scheduled Election');
      expect(within(card).getByText(/Filing opens Nov 20, 8:00 AM/)).toBeInTheDocument();
      expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    });

    it('offers Read the rules and file candidacy while filing is open', async () => {
      getElections.mockResolvedValue([phased(2, 'Filing Election', 'filing')]);
      renderPage();
      await screen.findByText('Filing Election');
      expect(within(cardFor('Filing Election')).getByRole('link', { name: 'Read the rules and file candidacy' })).toHaveAttribute('href', '/dashboard/elections/election-info?record=2');
      expect(within(cardFor('Filing Election')).getByText('Filing')).toBeInTheDocument();
    });

    it('offers See the election during screening and campaign', async () => {
      getElections.mockResolvedValue([phased(3, 'Screening Election', 'screening'), phased(4, 'Campaign Election', 'campaign')]);
      renderPage();
      await screen.findByText('Screening Election');
      expect(within(cardFor('Screening Election')).getByRole('link', { name: 'See the election' })).toHaveAttribute('href', '/dashboard/elections/election-info?record=3');
      expect(within(cardFor('Campaign Election')).getByRole('link', { name: 'See the election' })).toHaveAttribute('href', '/dashboard/elections/election-info?record=4');
    });

    it('offers the ballot while voting is open and again in the runoff', async () => {
      const list = [
        phased(5, 'Voting Election', 'voting', { status: 'active', finalized_at: iso(-3 * HOUR), start_time: iso(-HOUR), end_time: iso(HOUR), open_round: 1 }),
        phased(6, 'Runoff Election', 'runoff', { status: 'active', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), open_round: 2 }),
      ];
      getElections.mockResolvedValue(list);
      getElectionDetails.mockImplementation(async (id) => list.find((item) => item.id === id));
      renderPage();
      await screen.findByText('Voting Election');
      expect(within(cardFor('Voting Election')).getByRole('link', { name: 'Vote in this election' })).toHaveAttribute('href', '/elections/5/vote');
      expect(within(cardFor('Runoff Election')).getByRole('link', { name: 'Vote in this election' })).toHaveAttribute('href', '/elections/6/vote');
    });

    it('shows Voted with the receipt reference and time instead of the ballot link', async () => {
      const list = [phased(7, 'Voted Election', 'voting', { status: 'active', finalized_at: iso(-3 * HOUR), start_time: iso(-HOUR), end_time: iso(HOUR), open_round: 1, has_voted: true, my_ballot: { receipt_ref: 'RCPT-9', submitted_at: '2026-11-13T09:30:00.000Z', round: 1 } })];
      getElections.mockResolvedValue(list);
      getElectionDetails.mockResolvedValue(list[0]);
      renderPage();
      expect(await screen.findByText('RCPT-9')).toBeInTheDocument();
      const card = cardFor('Voted Election');
      expect(within(card).getByText('Voted')).toBeInTheDocument();
      expect(within(card).queryByRole('link', { name: 'Vote in this election' })).not.toBeInTheDocument();
      expect(within(card).getByText(/Nov 13, 5:30 PM/)).toBeInTheDocument();
    });

    it('says the votes are being counted after voting closes and links to results once released', async () => {
      const list = [
        phased(8, 'Counting Election', 'canvassing', { status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR) }),
        phased(9, 'Completed Election', 'completed', { status: 'closed', finalized_at: iso(-9 * HOUR), start_time: iso(-8 * HOUR), end_time: iso(-6 * HOUR), results_visible: true }),
      ];
      getElections.mockResolvedValue(list);
      getElectionDetails.mockImplementation(async (id) => list.find((item) => item.id === id));
      renderPage();
      await screen.findByText('Counting Election');
      expect(within(cardFor('Counting Election')).getByText(/being counted/)).toBeInTheDocument();
      expect(within(cardFor('Completed Election')).getByText('Closed')).toBeInTheDocument();
      expect(within(cardFor('Completed Election')).getByRole('link', { name: 'View results' })).toHaveAttribute('href', '/dashboard/elections/election-results?record=9');
    });

    it('says voting is paused when the server has no round open during the voting phase', async () => {
      const list = [phased(10, 'Paused Election', 'voting', { status: 'active', finalized_at: iso(-3 * HOUR), start_time: iso(-HOUR), end_time: iso(HOUR), open_round: null })];
      getElections.mockResolvedValue(list);
      getElectionDetails.mockResolvedValue(list[0]);
      renderPage();
      await screen.findByText('Paused Election');
      expect(within(cardFor('Paused Election')).getByText(/Voting is not open right now/)).toBeInTheDocument();
      expect(within(cardFor('Paused Election')).queryByRole('link', { name: 'Vote in this election' })).not.toBeInTheDocument();
    });

    it('keeps the legacy card for an election with no phase and reads has_voted when it is sent', async () => {
      const list = [{ ...open, id: 11, title: 'Legacy Voted', phase: null, has_voted: true, my_ballot: { receipt_ref: 'LEG-1', submitted_at: iso(-1000), round: 1 } }];
      getElections.mockResolvedValue(list);
      getElectionDetails.mockResolvedValue(list[0]);
      renderPage();
      expect(await screen.findByText('LEG-1')).toBeInTheDocument();
      expect(within(cardFor('Legacy Voted')).getByText('Voted')).toBeInTheDocument();
    });
  });
});
