import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnnouncementsFeedPage from './AnnouncementsFeedPage';

const mocks = vi.hoisted(() => ({
  getAnnouncements: vi.fn(),
  setAnnouncementReaction: vi.fn(),
  getNotifications: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../../services/announcementService', () => ({ getAnnouncements: mocks.getAnnouncements, setAnnouncementReaction: mocks.setAnnouncementReaction }));
vi.mock('../../../services/notificationService', () => ({ getNotifications: mocks.getNotifications, markRead: mocks.markRead }));

const renderFeed = () => render(<MemoryRouter initialEntries={['/dashboard/announcements/view-announcements']}><AnnouncementsFeedPage /></MemoryRouter>);

describe('AnnouncementsFeedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    mocks.getNotifications.mockResolvedValue({ data: { notifications: [] } });
  });

  it('shows centered organization posts and saves a heart reaction', async () => {
    mocks.getAnnouncements.mockResolvedValue({ data: [
      { id: 1, title: 'General Assembly', body: 'All members are invited.', image_url: '/storage/announcements/assembly.png', category: 'general', target_role: 'all', is_published: true, created_at: '2026-09-01T08:00:00Z', reactions_count: 0, is_liked: false, organization: { name: 'HIUSA Council' } },
      { id: 2, title: 'Election Schedule', body: 'Voting opens next week.', category: 'election', target_role: 'STUDENT', is_published: true, created_at: '2026-08-30T08:00:00Z', organization: { name: 'HIUSA Council' } },
    ] });
    mocks.setAnnouncementReaction.mockResolvedValue({ data: { reactions_count: 1, is_liked: true } });

    renderFeed();
    expect(screen.getByRole('textbox', { name: 'Search announcements' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'General Assembly' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Election Schedule' })).toBeInTheDocument();
    expect(screen.getAllByText('HIUSA Council')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'General Assembly' })).toHaveAttribute('src', expect.stringContaining('/storage/announcements/assembly.png'));
    fireEvent.click(screen.getAllByRole('button', { name: /Like 0/ })[0]);
    await waitFor(() => expect(mocks.setAnnouncementReaction).toHaveBeenCalledWith(1, true));
    expect(screen.queryByText(/For Students/)).not.toBeInTheDocument();
  });

  it('renders the shared page header with one h1', async () => {
    mocks.getAnnouncements.mockResolvedValue({ data: [] });
    renderFeed();
    await screen.findByText('No announcements yet');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Announcements' })).toBeInTheDocument();
  });

  it('explains a first-run feed and who fills it', async () => {
    mocks.getAnnouncements.mockResolvedValue({ data: [] });
    renderFeed();
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();
    expect(screen.getByText('Your officers post them here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers Clear filters when a search finds nothing', async () => {
    mocks.getAnnouncements.mockImplementation((params) => Promise.resolve({ data: params.search ? [] : [{ id: 1, title: 'General Assembly', body: 'Everyone is invited.', created_at: '2026-09-01T08:00:00Z', organization: { name: 'HIUSA Council' } }] }));
    renderFeed();
    await screen.findByRole('heading', { name: 'General Assembly' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search announcements' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('No announcements match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('heading', { name: 'General Assembly' })).toBeInTheDocument();
  });
});
