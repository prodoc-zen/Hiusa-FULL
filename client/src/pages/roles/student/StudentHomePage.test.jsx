import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentHomePage from './StudentHomePage';
import { getStudentFeed } from '../../../services/studentFeedService';
import { getBriefing } from '../../../services/dashboardService';

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
    expect(screen.getByRole('heading', { name: 'Classes Suspended' })).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(getStudentFeed).toHaveBeenCalledWith(1, 12);
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
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

  it('names the first action when the feed is empty', async () => {
    getStudentFeed.mockResolvedValue({ organization: null, items: [], sidebar: { active_election: null, upcoming_events: [] }, pagination: { current_page: 1, has_more: false, next_page: null } });
    render(<MemoryRouter><StudentHomePage /></MemoryRouter>);

    expect(await screen.findByText('Your feed is quiet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find an event to join' })).toHaveAttribute('href', '/dashboard/events/activity-calendar');
  });

  it('finishes loading the feed under the application StrictMode wrapper', async () => {
    render(<StrictMode><MemoryRouter><StudentHomePage /></MemoryRouter></StrictMode>);

    expect(await screen.findByRole('heading', { name: 'Classes Suspended' })).toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});
