import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnnouncementsFeedPage from './AnnouncementsFeedPage';

const mocks = vi.hoisted(() => ({
  getAnnouncements: vi.fn(),
  setAnnouncementReaction: vi.fn(),
  getNotifications: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../../services/announcementService', () => ({ getAnnouncements: mocks.getAnnouncements, setAnnouncementReaction: mocks.setAnnouncementReaction }));
vi.mock('../../../services/notificationService', () => ({ getNotifications: mocks.getNotifications, markRead: mocks.markRead }));

describe('AnnouncementsFeedPage', () => {
  it('shows centered organization posts and saves a heart reaction', async () => {
    mocks.getNotifications.mockResolvedValue({ data: { notifications: [] } });
    mocks.getAnnouncements.mockResolvedValue({ data: [
      { id: 1, title: 'General Assembly', body: 'All members are invited.', image_url: '/storage/announcements/assembly.png', category: 'general', target_role: 'all', is_published: true, created_at: '2026-09-01T08:00:00Z', reactions_count: 0, is_liked: false, organization: { name: 'HIUSA Council' } },
      { id: 2, title: 'Election Schedule', body: 'Voting opens next week.', category: 'election', target_role: 'STUDENT', is_published: true, created_at: '2026-08-30T08:00:00Z', organization: { name: 'HIUSA Council' } },
    ] });
    mocks.setAnnouncementReaction.mockResolvedValue({ data: { reactions_count: 1, is_liked: true } });

    render(<AnnouncementsFeedPage />);
    expect(screen.getByRole('textbox', { name: 'Search announcements' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'General Assembly' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Election Schedule' })).toBeInTheDocument();
    expect(screen.getAllByText('HIUSA Council')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'General Assembly' })).toHaveAttribute('src', expect.stringContaining('/storage/announcements/assembly.png'));
    fireEvent.click(screen.getAllByRole('button', { name: /Like 0/ })[0]);
    await waitFor(() => expect(mocks.setAnnouncementReaction).toHaveBeenCalledWith(1, true));
    expect(screen.queryByText(/For Students/)).not.toBeInTheDocument();
  });
});
