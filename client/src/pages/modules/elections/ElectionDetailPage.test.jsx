import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('ElectionDetailPage counts for an election where students file their own candidacy', () => {
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString();
  const filingElection = () => ({
    ...outlet.election,
    status: 'upcoming',
    phase: 'screening',
    finalized_at: null,
    filing_starts_at: day(-5),
    filing_ends_at: day(-2),
    screening_starts_at: day(-1),
    screening_ends_at: day(2),
    campaign_starts_at: day(3),
    campaign_ends_at: day(6),
    start_time: day(7),
    end_time: day(8),
    results_publish_at: day(9),
    voters_count: 12,
    application_counts: { pending_review: 4, for_revision: 1, approved: 2, rejected: 1, withdrawn: 0 },
    positions: [{ id: 1, title: 'President', max_winners: 1, result_status: 'tie_pending' }, { id: 2, title: 'Treasurer', max_winners: 1, result_status: 'decided' }, { id: 3, title: 'Auditor', max_winners: 1, result_status: 'runoff_required' }],
    candidates: [{ id: 3, position_id: 1, user: { first_name: 'Ana', last_name: 'Reyes' } }, { id: 4, position_id: 2, user: { first_name: 'Ben', last_name: 'Cruz' } }],
  });

  const original = outlet.election;
  afterEach(() => { outlet.election = original; });
  const renderPage = (election) => {
    outlet.election = election;
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5']}><ElectionDetailPage /></MemoryRouter>);
  };
  const countOf = (label) => within(screen.getByRole('group', { name: 'Election counts' })).getByText(label).closest('div');

  it('shows one row of plain counts', () => {
    renderPage(filingElection());
    expect(countOf('Pending review')).toHaveTextContent('Pending review4');
    expect(countOf('Needs correction')).toHaveTextContent('Needs correction1');
    expect(countOf('Approved candidates')).toHaveTextContent('Approved candidates2');
    expect(countOf('Turnout')).toHaveTextContent('Turnout12');
    expect(countOf('Unresolved ties')).toHaveTextContent('Unresolved ties2');
  });

  it('names the next deadline and its date on one line', () => {
    renderPage(filingElection());
    expect(screen.getByText(/^Next: Screening closes on /)).toBeInTheDocument();
  });

  it('shows no counts row and no next line for an election where the Admin adds the candidates', () => {
    renderPage({ ...outlet.election });
    expect(screen.queryByRole('group', { name: 'Election counts' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Next:/)).not.toBeInTheDocument();
  });

  it('shows zero counts when the server sent none yet, and no next line once every date has passed', () => {
    renderPage({ ...filingElection(), application_counts: undefined, voters_count: undefined, positions: [], candidates: [], filing_starts_at: day(-20), filing_ends_at: day(-19), screening_starts_at: day(-18), screening_ends_at: day(-17), campaign_starts_at: day(-16), campaign_ends_at: day(-15), start_time: day(-14), end_time: day(-13), results_publish_at: day(-12) });
    expect(countOf('Pending review')).toHaveTextContent('Pending review0');
    expect(countOf('Unresolved ties')).toHaveTextContent('Unresolved ties0');
    expect(screen.queryByText(/^Next:/)).not.toBeInTheDocument();
  });
});
