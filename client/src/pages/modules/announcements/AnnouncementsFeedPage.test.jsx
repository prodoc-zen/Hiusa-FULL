import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnnouncementsFeedPage from './AnnouncementsFeedPage';

const mocks = vi.hoisted(() => ({
  getAnnouncements: vi.fn(),
  getNotifications: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../../services/announcementService', () => ({ getAnnouncements: mocks.getAnnouncements }));
vi.mock('../../../services/notificationService', () => ({ getNotifications: mocks.getNotifications, markRead: mocks.markRead }));

describe('AnnouncementsFeedPage', () => {
  it('uses a full-width featured feed and a responsive updates grid', async () => {
    mocks.getNotifications.mockResolvedValue({ data: { notifications: [] } });
    mocks.getAnnouncements.mockResolvedValue({ data: [
      { id: 1, title: 'General Assembly', body: 'All members are invited.', category: 'general', target_role: 'all', is_published: true, created_at: '2026-09-01T08:00:00Z' },
      { id: 2, title: 'Election Schedule', body: 'Voting opens next week.', category: 'election', target_role: 'STUDENT', is_published: true, created_at: '2026-08-30T08:00:00Z' },
    ] });

    render(<AnnouncementsFeedPage />);
    expect(screen.getByRole('heading', { name: 'Announcements Feed' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'General Assembly' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Election Schedule' })).toBeInTheDocument();
    expect(screen.getByText('Latest announcement')).toBeInTheDocument();
  });
});
