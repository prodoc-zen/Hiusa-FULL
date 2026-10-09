import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalAnnouncementsPage from './GlobalAnnouncementsPage';
import { deleteGlobalAnnouncement, getGlobalAnnouncements } from '../../../services/systemAdministrationService';

vi.mock('../../../services/systemAdministrationService', () => ({
  getGlobalAnnouncements: vi.fn(),
  getSystemOrganizations: vi.fn(() => Promise.resolve({ data: [] })),
  createGlobalAnnouncement: vi.fn(),
  updateGlobalAnnouncement: vi.fn(),
  archiveGlobalAnnouncement: vi.fn(),
  deleteGlobalAnnouncement: vi.fn(),
}));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const draft = { id: 5, title: 'Enrollment reminder', body: 'Soon', published_at: null, is_published: false, target_scope: 'all_users', recipients_count: 0 };
const published = { id: 6, title: 'Campus closure', body: 'Closed', published_at: '2026-10-01T00:00:00Z', is_published: true, target_scope: 'all_users', recipients_count: 40 };

describe('GlobalAnnouncementsPage delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGlobalAnnouncements).mockResolvedValue({ data: [draft, published] });
  });

  it('offers delete for drafts only, and keeps Archive for published notices', async () => {
    render(<GlobalAnnouncementsPage />);
    expect(await screen.findByText(/enrollment reminder/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Delete draft/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Archive/ })).toBeInTheDocument();
  });

  it('deletes a draft after confirmation and reloads the list', async () => {
    vi.mocked(deleteGlobalAnnouncement).mockResolvedValue({ message: 'Deleted.' });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete draft/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this draft?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));

    await waitFor(() => expect(deleteGlobalAnnouncement).toHaveBeenCalledWith(5));
    await waitFor(() => expect(getGlobalAnnouncements).toHaveBeenCalledTimes(2));
  });

  it('shows the server message when the announcement cannot be deleted', async () => {
    vi.mocked(deleteGlobalAnnouncement).mockRejectedValue({ response: { status: 409, data: { message: 'Published announcements cannot be deleted. Archive them instead.' } } });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete draft/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this draft?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Published announcements cannot be deleted. Archive them instead.');
  });
});
