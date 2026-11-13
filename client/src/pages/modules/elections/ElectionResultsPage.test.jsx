import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ElectionResultsPage from './ElectionResultsPage';
import { PERIOD_KEY } from '../../../utils/academicPeriodStore';

const { getElectionResults, getElections, scheduleRunoff, resolveTie, electionContext } = vi.hoisted(() => ({ getElectionResults: vi.fn(), scheduleRunoff: vi.fn(), resolveTie: vi.fn(), getElections: vi.fn().mockResolvedValue([]), electionContext: { election: { id: 5, title: 'Final Council Election', status: 'closed', finalized_at: '2026-09-01T08:00:00Z', results_visible: true, voters_count: 30 }, role: 'STUDENT' } }));

vi.mock('../../../services/electionService', () => ({ getElectionResults, getElections, scheduleRunoff, resolveTie }));
vi.mock('../../../components/elections/ElectionReportsMenu', () => ({ default: ({ role }) => <div data-testid="reports-menu">{role}</div> }));
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

const CLOSED = electionContext.election;
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

function useContext(election = {}, role = 'STUDENT') {
  electionContext.election = { ...CLOSED, tally_version: 2, ...election };
  electionContext.role = role;
}

function row(id, title, status, extra = {}) {
  return {
    position: { id, title, max_winners: 1 },
    status,
    totalVotes: 0,
    winner_ids: [],
    tie: false,
    runoff: null,
    resolution: null,
    access_handed_over: false,
    officer_access: null,
    term_starts_on: null,
    candidates: [],
    ...extra,
  };
}

const ana = { id: 10, name: 'Ana Reyes', partylist: 'Forward', votes: 25, runoff_votes: null };
const luis = { id: 11, name: 'Luis Cruz', partylist: 'Independent', votes: 15, runoff_votes: null };
const mia = { id: 20, name: 'Mia Lopez', partylist: 'Forward', votes: 3, runoff_votes: null };
const rey = { id: 21, name: 'Rey Tan', partylist: 'Independent', votes: 3, runoff_votes: null };

describe('ElectionResultsPage with a counted election (tally version 2)', () => {
  afterEach(() => {
    electionContext.election = CLOSED;
    electionContext.role = 'STUDENT';
    vi.clearAllMocks();
  });

  it('says who won with the totals', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(1, 'President', 'decided', { totalVotes: 40, winner_ids: [10], candidates: [ana, luis] })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Winner: Ana Reyes (25 votes)')).toBeInTheDocument();
  });

  it('names several winners of a multi-seat position', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(1, 'Senator', 'decided', { totalVotes: 40, winner_ids: [10, 11], candidates: [ana, luis] })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Winners: Ana Reyes (25 votes), Luis Cruz (15 votes)')).toBeInTheDocument();
  });

  it('says a candidate was elected unopposed', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(1, 'Auditor', 'unopposed', { winner_ids: [10], candidates: [{ ...ana, votes: 0 }] })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Elected unopposed')).toBeInTheDocument();
    expect(screen.queryByText(/Winner: /)).not.toBeInTheDocument();
  });

  it('says a position is vacant when nobody ran', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(1, 'Treasurer', 'vacant')]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Vacant: no candidates')).toBeInTheDocument();
    expect(screen.queryByText('No candidate result data is available.')).not.toBeInTheDocument();
  });

  it('names the tied candidates when a runoff is required', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'runoff_required', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1, starts_at: null, ends_at: null, publish_at: null } })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Runoff required: Mia Lopez, Rey Tan')).toBeInTheDocument();
    expect(screen.queryByText('Tie, assign manually')).not.toBeInTheDocument();
    expect(screen.queryByText(/Treasurer is tied/)).not.toBeInTheDocument();
  });

  it('shows the dates of a scheduled runoff', async () => {
    useContext({ runoff_starts_at: FUTURE, runoff_ends_at: FUTURE, runoff_publish_at: FUTURE });
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'runoff_scheduled', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1, starts_at: '2099-03-02T00:00:00.000Z', ends_at: '2099-03-02T09:00:00.000Z', publish_at: '2099-03-03T01:00:00.000Z' } })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText(/^Runoff scheduled for Mar 2, 2099/)).toBeInTheDocument();
  });

  it('says runoff voting is open', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'runoff_voting', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1, starts_at: PAST, ends_at: FUTURE, publish_at: FUTURE } })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Runoff voting is open')).toBeInTheDocument();
  });

  it('says a tie waits for the Department Head', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'tie_pending', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1 } })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Pending tie resolution by the Department Head')).toBeInTheDocument();
  });

  it('shows who settled a tie, the rule used and the explanation', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'resolved', {
      totalVotes: 6,
      winner_ids: [21],
      candidates: [mia, rey],
      runoff: { candidate_ids: [20, 21], seats: 1 },
      resolution: { rule_used: 'Longest membership', explanation: 'Rey has served three terms.', resolved_by: 'Dr. Lim', resolved_at: PAST },
    })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Tie resolved by Dr. Lim')).toBeInTheDocument();
    expect(screen.getByText('Rule used: Longest membership')).toBeInTheDocument();
    expect(screen.getByText('Rey has served three terms.')).toBeInTheDocument();
  });

  it('puts the first round and the runoff totals side by side once the runoff has totals', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'decided', { totalVotes: 6, winner_ids: [21], candidates: [{ ...mia, runoff_votes: 4 }, { ...rey, runoff_votes: 9 }], runoff: { candidate_ids: [20, 21], seats: 1 } })]);
    render(<ElectionResultsPage />);
    const table = await screen.findByRole('table', { name: 'Results for Treasurer' });
    expect(within(table).getByRole('columnheader', { name: 'Runoff votes' })).toBeInTheDocument();
    expect(within(table).getByText('9')).toBeInTheDocument();
  });

  it('has no runoff column when there is no runoff total', async () => {
    useContext();
    getElectionResults.mockResolvedValue([row(1, 'President', 'decided', { totalVotes: 40, winner_ids: [10], candidates: [ana, luis] })]);
    render(<ElectionResultsPage />);
    await screen.findByRole('table', { name: 'Results for President' });
    expect(screen.queryByRole('columnheader', { name: 'Runoff votes' })).not.toBeInTheDocument();
  });

  it('shows the officer access of a winner in place of Access handed over', async () => {
    useContext();
    getElectionResults.mockResolvedValue([
      row(1, 'President', 'decided', { totalVotes: 40, winner_ids: [10], candidates: [ana, luis], officer_access: 'upcoming', term_starts_on: '2026-12-15' }),
      row(3, 'Secretary', 'unopposed', { winner_ids: [30], candidates: [{ id: 30, name: 'Pia Cruz', partylist: 'Independent', votes: 0 }], officer_access: 'active' }),
    ]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Upcoming officer, access starts Dec 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Officer access active')).toBeInTheDocument();
    expect(screen.queryByText('Access handed over')).not.toBeInTheDocument();
  });

  it('keeps the old wording for a tally version 1 election', async () => {
    useContext({ tally_version: 1 });
    getElectionResults.mockResolvedValue([
      row(1, 'President', 'decided', { totalVotes: 40, winner_ids: [10], candidates: [ana, luis], access_handed_over: true }),
      row(2, 'Treasurer', 'tie', { tie: true, totalVotes: 6, candidates: [mia, rey] }),
    ]);
    render(<ElectionResultsPage />);
    expect(await screen.findByText('Access handed over')).toBeInTheDocument();
    expect(screen.getAllByText('Tie, assign manually').length).toBeGreaterThan(0);
    expect(screen.getByText(/Treasurer is tied/)).toBeInTheDocument();
    expect(screen.queryByText(/^Winner: /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Runoff required/)).not.toBeInTheDocument();
  });

  it('shows the other positions as final while one is unresolved', async () => {
    useContext();
    getElectionResults.mockResolvedValue([
      row(1, 'President', 'decided', { totalVotes: 40, winner_ids: [10], candidates: [ana, luis] }),
      row(2, 'Treasurer', 'runoff_required', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1 } }),
    ]);
    render(<ElectionResultsPage />);
    const winners = await screen.findByRole('table', { name: 'Final winners by position' });
    expect(within(winners).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(winners).queryByText('Mia Lopez')).not.toBeInTheDocument();
    expect(screen.getByText('Runoff required: Mia Lopez, Rey Tan')).toBeInTheDocument();
  });
});

describe('ElectionResultsPage runoff schedule form', () => {
  afterEach(() => {
    electionContext.election = CLOSED;
    electionContext.role = 'STUDENT';
    vi.clearAllMocks();
  });

  const needsRunoff = [row(2, 'Treasurer', 'runoff_required', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1 } })];

  it('shows the Admin the form when a position needs a runoff and sends the schedule', async () => {
    useContext({}, 'ADMIN');
    getElectionResults.mockResolvedValue(needsRunoff);
    scheduleRunoff.mockResolvedValue({ success: true });
    render(<ElectionResultsPage />);
    fireEvent.change(await screen.findByLabelText('Runoff voting starts'), { target: { value: '2099-03-02T08:00' } });
    fireEvent.change(screen.getByLabelText('Runoff voting ends'), { target: { value: '2099-03-02T17:00' } });
    fireEvent.change(screen.getByLabelText('Results published'), { target: { value: '2099-03-03T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule runoff' }));
    await waitFor(() => expect(scheduleRunoff).toHaveBeenCalledWith(5, {
      runoff_starts_at: new Date('2099-03-02T08:00').toISOString(),
      runoff_ends_at: new Date('2099-03-02T17:00').toISOString(),
      runoff_publish_at: new Date('2099-03-03T09:00').toISOString(),
    }));
    await waitFor(() => expect(getElectionResults).toHaveBeenCalledTimes(2));
  });

  it('offers Update schedule while a runoff is scheduled but has not started', async () => {
    useContext({ runoff_starts_at: FUTURE, runoff_ends_at: FUTURE, runoff_publish_at: FUTURE }, 'ADMIN');
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'runoff_scheduled', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1, starts_at: FUTURE, ends_at: FUTURE, publish_at: FUTURE } })]);
    render(<ElectionResultsPage />);
    expect(await screen.findByRole('button', { name: 'Update schedule' })).toBeInTheDocument();
  });

  it('hides the form once the runoff has started', async () => {
    useContext({ runoff_starts_at: PAST, runoff_ends_at: FUTURE, runoff_publish_at: FUTURE }, 'ADMIN');
    getElectionResults.mockResolvedValue([row(2, 'Treasurer', 'runoff_voting', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1, starts_at: PAST, ends_at: FUTURE, publish_at: FUTURE } })]);
    render(<ElectionResultsPage />);
    await screen.findByText('Runoff voting is open');
    expect(screen.queryByLabelText('Runoff voting starts')).not.toBeInTheDocument();
  });

  it('hides the form when no position needs a runoff', async () => {
    useContext({}, 'ADMIN');
    getElectionResults.mockResolvedValue([row(1, 'President', 'decided', { totalVotes: 40, winner_ids: [10], candidates: [ana, luis] })]);
    render(<ElectionResultsPage />);
    await screen.findByText('Winner: Ana Reyes (25 votes)');
    expect(screen.queryByLabelText('Runoff voting starts')).not.toBeInTheDocument();
  });

  it.each(['STUDENT', 'SBO_OFFICER', 'DEPARTMENT_HEAD'])('does not show the form to a %s', async (role) => {
    useContext({}, role);
    getElectionResults.mockResolvedValue(needsRunoff);
    render(<ElectionResultsPage />);
    await screen.findByText('Runoff required: Mia Lopez, Rey Tan');
    expect(screen.queryByLabelText('Runoff voting starts')).not.toBeInTheDocument();
  });
});

describe('ElectionResultsPage tie resolution form', () => {
  afterEach(() => {
    electionContext.election = CLOSED;
    electionContext.role = 'STUDENT';
    vi.clearAllMocks();
  });

  const tied = [row(2, 'Treasurer', 'tie_pending', { tie: true, totalVotes: 6, candidates: [mia, rey], runoff: { candidate_ids: [20, 21], seats: 1 } })];

  it('shows the Department Head the form and sends the decision after a confirm', async () => {
    useContext({ tie_break_rule: 'Longest membership.' }, 'DEPARTMENT_HEAD');
    getElectionResults.mockResolvedValue(tied);
    resolveTie.mockResolvedValue({ success: true });
    render(<ElectionResultsPage />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Rey Tan/ }));
    fireEvent.change(screen.getByLabelText('Written explanation'), { target: { value: 'Three terms of service.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(resolveTie).toHaveBeenCalledWith(5, 2, { winner_candidate_ids: [21], explanation: 'Three terms of service.' }));
    await waitFor(() => expect(getElectionResults).toHaveBeenCalledTimes(2));
  });

  it('shows the SAO the form only when the SAO approves this election', async () => {
    useContext({ approval_required_role: 'SUPER_ADMIN', tie_break_rule: 'x' }, 'SUPER_ADMIN');
    getElectionResults.mockResolvedValue(tied);
    const { unmount } = render(<ElectionResultsPage />);
    expect(await screen.findByRole('button', { name: 'Record decision' })).toBeInTheDocument();
    unmount();

    useContext({ approval_required_role: 'DEPARTMENT_HEAD', tie_break_rule: 'x' }, 'SUPER_ADMIN');
    render(<ElectionResultsPage />);
    await screen.findByText('Pending tie resolution by the Department Head');
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
  });

  it.each(['STUDENT', 'SBO_OFFICER', 'ADMIN'])('does not show the form to a %s', async (role) => {
    useContext({ tie_break_rule: 'x' }, role);
    getElectionResults.mockResolvedValue(tied);
    render(<ElectionResultsPage />);
    await screen.findByText('Pending tie resolution by the Department Head');
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
  });

  it('lets the reviewer read a tie before the results are published', async () => {
    useContext({ phase: 'tie_resolution', results_visible: false, tie_break_rule: 'x' }, 'DEPARTMENT_HEAD');
    getElectionResults.mockResolvedValue(tied);
    render(<ElectionResultsPage />);
    expect(await screen.findByRole('button', { name: 'Record decision' })).toBeInTheDocument();
    expect(getElectionResults).toHaveBeenCalledWith(5);
  });

  it('keeps results hidden from the reviewer before publication outside the tie phase', () => {
    useContext({ phase: 'canvassing', results_visible: false }, 'DEPARTMENT_HEAD');
    render(<ElectionResultsPage />);
    expect(screen.getByText('Election results are not available yet.')).toBeInTheDocument();
    expect(getElectionResults).not.toHaveBeenCalled();
  });
});

describe('ElectionResultsPage reports menu', () => {
  afterEach(() => {
    electionContext.election = CLOSED;
    electionContext.role = 'STUDENT';
    vi.clearAllMocks();
  });

  it.each(['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'])('is in the header for a %s', async (role) => {
    useContext({}, role);
    getElectionResults.mockResolvedValue([]);
    render(<ElectionResultsPage />);
    expect(await screen.findByTestId('reports-menu')).toHaveTextContent(role);
  });

  it('is not rendered for a student', async () => {
    useContext({}, 'STUDENT');
    getElectionResults.mockResolvedValue([]);
    render(<ElectionResultsPage />);
    await screen.findByText('No result data yet');
    expect(screen.queryByTestId('reports-menu')).not.toBeInTheDocument();
  });
});
