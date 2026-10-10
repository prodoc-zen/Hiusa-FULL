import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CastVoteRedirectPage from './CastVoteRedirectPage';

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

  it('still lists an election when its details cannot be loaded', async () => {
    getElections.mockResolvedValue([{ ...open, id: 1, title: 'Election 1' }]);
    getElectionDetails.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Election 1')).toBeInTheDocument();
  });

  it('names what to expect when no election is open', async () => {
    getElections.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No election is open for voting')).toBeInTheDocument();
    expect(screen.getByText(/Elections appear here when the Admin opens one/)).toBeInTheDocument();
  });
});
