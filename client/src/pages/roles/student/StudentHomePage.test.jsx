import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentHomePage from './StudentHomePage';
import { getStudentFeed } from '../../../services/studentFeedService';
import { getBriefing } from '../../../services/dashboardService';
import { PERIOD_KEY } from '../../../utils/academicPeriodStore';

vi.mock('../../../components/process', () => ({ ProcessTracker: () => <div data-testid="process-tracker" /> }));
vi.mock('../../../services/studentFeedService', () => ({ getStudentFeed: vi.fn() }));
vi.mock('../../../services/dashboardService', () => ({
  getBriefing: vi.fn(() => Promise.resolve({ data: { user: { first_name: 'Ana', role: 'STUDENT', organization: { id: 1, name: 'Supreme Student Council' } }, summary: { attention_count: 0, headline: "You're all caught up." }, attention: [], pillars: {}, insights: [] } })),
}));

describe('StudentHomePage', () => {
  beforeEach(() => {
    window.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
    getStudentFeed.mockResolvedValue({
      organization: { id: 1, name: 'HIUSA Student Council', acronym: 'HIUSA' },
      items: [{
        key: 'announcement-5',
        type: 'announcement',
        sort_at: new Date().toISOString(),
        is_pinned: true,
        data: { id: 5, title: 'Classes suspended', body: 'Please stay safe and wait for further updates.', is_important: true },
      }],
      sidebar: { active_election: null, upcoming_events: [] },
      pagination: { current_page: 1, has_more: false, next_page: null },
    });
  });

  it('renders an organization-centered responsive feed from one paginated request', async () => {
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Organization feed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Classes suspended' })).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(getStudentFeed).toHaveBeenCalledWith(1, 12);
    expect(screen.queryByText('You’re all caught up.')).not.toBeInTheDocument();
  });

  it('opens a phone on the newest post and shows the rest after one tap', async () => {
    getStudentFeed.mockResolvedValue({
      organization: { id: 1, name: 'HIUSA Student Council', acronym: 'HIUSA' },
      items: [1, 2, 3, 4].map((id) => ({ key: `announcement-${id}`, type: 'announcement', sort_at: new Date().toISOString(), is_pinned: false, data: { id, title: `Post number ${id}`, body: 'Body text for the post.', is_important: false } })),
      sidebar: { active_election: null, upcoming_events: [] },
      pagination: { current_page: 1, has_more: false, next_page: null },
    });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    const hiddenOnPhone = () => screen.getAllByRole('heading', { level: 3 }).filter((heading) => heading.closest('[class~="max-sm:hidden"]'));
    await screen.findByRole('region', { name: 'Organization feed' });
    expect(hiddenOnPhone().map((heading) => heading.textContent)).toEqual(['Post number 2', 'Post number 3', 'Post number 4']);
    fireEvent.click(screen.getByRole('button', { name: 'Show more posts' }));
    expect(hiddenOnPhone()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Show more posts' })).not.toBeInTheDocument();
  });

  it('shows owed balance and clearance cues as links, with no Tasks pillar', async () => {
    vi.mocked(getBriefing).mockResolvedValueOnce({ data: {
      user: { first_name: 'Ana', role: 'STUDENT', organization: { id: 1, name: 'Supreme Student Council' } },
      summary: { attention_count: 0, headline: "You're all caught up." },
      setup: { completed: 0, total: 3, steps: [
        { key: 'contact', label: 'Add your contact number', detail: 'd', done: false, href: '/dashboard/profile' },
        { key: 'fingerprint', label: 'Enroll your fingerprint', detail: 'd', done: false, href: null },
        { key: 'event', label: 'Register for an upcoming event', detail: 'd', done: false, href: '/dashboard/events/activity-calendar' },
      ] },
      attention: [],
      pillars: { events: { value: 1, unit: 'count', label: 'Upcoming events', context: 'One' }, tasks: { value: 2, unit: 'count', label: 'My open tasks', context: 'Two' } },
      insights: [],
    } });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Next for you' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Statement of account/ })).toHaveAttribute('href', '/dashboard/finance/statement-of-account');
    expect(screen.getByRole('link', { name: /My clearance/ })).toHaveAttribute('href', '/dashboard/my-clearance');
    expect(await screen.findByText('Upcoming events')).toBeInTheDocument();
    expect(screen.queryByText('My open tasks')).not.toBeInTheDocument();
  });

  const briefingWith = (account) => ({ data: {
    user: { first_name: 'Ana', role: 'STUDENT', organization: { id: 1, name: 'Supreme Student Council' } },
    summary: { attention_count: 0, headline: "You're all caught up." },
    attention: [], pillars: {}, insights: [],
    ...(account === undefined ? {} : { account }),
  } });

  it('shows what is owed and the clearance state as links in the account panel', async () => {
    vi.mocked(getBriefing).mockResolvedValueOnce(briefingWith({ owed_total: '610.50', has_open_invoices: true, clearance: { status: 'in_progress', pending_count: 2, held_count: 0 } }));
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: /You owe ₱610\.50/ })).toHaveAttribute('href', '/dashboard/finance/statement-of-account');
    expect(screen.getByRole('link', { name: /Clearance: 2 signatures pending/ })).toHaveAttribute('href', '/dashboard/my-clearance');
  });

  it.each([
    [{ owed_total: '0.00', has_open_invoices: false, clearance: { status: 'cleared', pending_count: 0, held_count: 0 } }, /Nothing owed/, /Clearance: Cleared/],
    [{ owed_total: '0', has_open_invoices: false, clearance: { status: 'held', pending_count: 1, held_count: 1 } }, /Nothing owed/, /On hold: see My clearance/],
    [{ owed_total: '0', has_open_invoices: false, clearance: { status: 'none', pending_count: 0, held_count: 0 } }, /Nothing owed/, /No clearance period/],
    [{ owed_total: '10.00', has_open_invoices: true, clearance: { status: 'in_progress', pending_count: 1, held_count: 0 } }, /You owe ₱10\.00/, /Clearance: 1 signature pending/],
  ])('words the account figures %#', async (account, owed, clearance) => {
    vi.mocked(getBriefing).mockResolvedValueOnce(briefingWith(account));
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: owed })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: clearance })).toHaveAttribute('href', '/dashboard/my-clearance');
  });

  it('keeps the account links when the briefing has no account key or fails', async () => {
    vi.mocked(getBriefing).mockResolvedValueOnce(briefingWith(undefined));
    const { unmount } = render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /Statement of account/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /My clearance/ })).toBeInTheDocument();
    expect(screen.queryByText(/You owe/)).not.toBeInTheDocument();
    unmount();

    vi.mocked(getBriefing).mockRejectedValueOnce(new Error('down'));
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    expect(await screen.findByText('Your briefing could not load')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Statement of account/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /My clearance/ })).toBeInTheDocument();
  });

  it('names the first action when the feed is empty', async () => {
    getStudentFeed.mockResolvedValue({ organization: null, items: [], sidebar: { active_election: null, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find an event to join' })).toHaveAttribute('href', '/dashboard/events/activity-calendar');
  });

  it('says what went wrong with the feed and offers one retry', async () => {
    getStudentFeed.mockRejectedValueOnce({ response: { status: 500 } });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    expect(await screen.findByText('Could not load your feed')).toBeInTheDocument();
    getStudentFeed.mockResolvedValueOnce({ organization: null, items: [], sidebar: { active_election: null, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();
  });

  it('offers voting as one plain link while an election is open, and says so after the vote', async () => {
    getStudentFeed.mockResolvedValue({ organization: null, items: [], sidebar: { active_election: { id: 4, title: 'SBO election', has_voted: false }, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    const { unmount } = render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    const voteLink = await screen.findByRole('link', { name: 'Vote now' });
    expect(voteLink).toHaveAttribute('href', '/elections/4/vote');
    expect(voteLink.closest('[class~="max-sm:hidden"]')).toBeNull();
    unmount();

    getStudentFeed.mockResolvedValue({ organization: null, items: [], sidebar: { active_election: { id: 4, title: 'SBO election', has_voted: true }, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    expect(await screen.findByText('Vote submitted')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vote now' })).not.toBeInTheDocument();
  });

  it('does not offer Vote now on an election post the ballot would refuse', async () => {
    const post = (can_vote) => ({ key: 'election-4', type: 'election', sort_at: new Date().toISOString(), is_pinned: false, data: { id: 4, title: 'SBO election', status: 'active', end_time: new Date(Date.now() + 3_600_000).toISOString(), has_voted: false, can_vote } });
    getStudentFeed.mockResolvedValue({ organization: null, items: [post(false)], sidebar: { active_election: null, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    const { unmount } = render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    expect(await screen.findByText('You joined after the voter list was finalized, so you cannot vote in this election.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vote now' })).not.toBeInTheDocument();
    unmount();

    getStudentFeed.mockResolvedValue({ organization: null, items: [post(true)], sidebar: { active_election: null, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Vote now' })).toHaveAttribute('href', '/elections/4/vote');
  });

  it('finishes loading the feed under the application StrictMode wrapper', async () => {
    render(<StrictMode><MemoryRouter><StudentHomePage /></MemoryRouter></StrictMode>);

    expect(await screen.findByRole('heading', { name: 'Classes suspended' })).toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('opens with the process tracker above everything else', async () => {
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);
    await screen.findByRole('region', { name: 'Organization feed' });
    const tracker = screen.getByTestId('process-tracker');
    expect(tracker.parentElement.firstElementChild).toBe(tracker);
  });

  describe('in a closed semester', () => {
    beforeEach(() => localStorage.setItem(PERIOD_KEY, JSON.stringify({ id: 2, status: 'completed', number: 2, academic_year: { label: '2025-2026' } })));
    afterEach(() => localStorage.removeItem(PERIOD_KEY));

    it('hides the current semester actions and says the dashboard shows the current semester only', async () => {
      getStudentFeed.mockResolvedValue({
        organization: null,
        items: [{ key: 'election-4', type: 'election', sort_at: new Date().toISOString(), is_pinned: false, data: { id: 4, title: 'SBO election', status: 'active', end_time: new Date(Date.now() + 3_600_000).toISOString(), has_voted: false, can_vote: true } }],
        sidebar: { active_election: { id: 4, title: 'SBO election', has_voted: false }, upcoming_events: [] },
        pagination: { current_page: 1, has_more: false, next_page: null },
      });
      vi.mocked(getBriefing).mockResolvedValueOnce({ data: {
        user: { first_name: 'Ana', role: 'STUDENT', organization: { id: 1, name: 'Supreme Student Council' } },
        summary: { attention_count: 1, headline: '1 item needs you today.' },
        setup: { completed: 0, total: 1, steps: [{ key: 'contact', label: 'Add contact number', detail: 'd', done: false, href: '/dashboard/profile' }] },
        attention: [{ id: 'vote-4', type: 'election_open', severity: 'normal', title: 'Vote now', detail: 'Cast your ballot', due_at: null, href: '/elections/4/vote' }],
        pillars: {}, insights: [],
      } });
      render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

      expect(await screen.findByText(/This semester is read only/)).toBeInTheDocument();
      expect(screen.queryByText('Vote now')).not.toBeInTheDocument();
      expect(screen.queryByText('Voting is open')).not.toBeInTheDocument();
      expect(screen.queryByText('Add contact number')).not.toBeInTheDocument();
      expect(screen.queryByTestId('process-tracker')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Activity calendar' })).toHaveAttribute('href', '/dashboard/events/activity-calendar');
      expect(screen.getByRole('link', { name: 'Election results' })).toHaveAttribute('href', '/dashboard/elections/election-results');
    });
  });
});
