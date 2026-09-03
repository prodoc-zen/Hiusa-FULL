import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentHomePage from './StudentHomePage';
import { getStudentFeed } from '../../../services/studentFeedService';

vi.mock('../../../services/studentFeedService', () => ({ getStudentFeed: vi.fn() }));

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
    expect(await screen.findByRole('heading', { level: 1, name: 'HIUSA Student Council' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Classes suspended' })).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(getStudentFeed).toHaveBeenCalledWith(1, 12);
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
  });

  it('finishes loading the feed under the application StrictMode wrapper', async () => {
    render(<StrictMode><MemoryRouter><StudentHomePage /></MemoryRouter></StrictMode>);

    expect(await screen.findByRole('heading', { name: 'Classes suspended' })).toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});
