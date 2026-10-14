import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalAnnouncementsPage from './GlobalAnnouncementsPage';
import { createGlobalAnnouncement, deleteGlobalAnnouncement, getGlobalAnnouncements } from '../../../services/systemAdministrationService';

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
    expect(await findRowAction(/Delete draft/)).toBeInTheDocument();
    expect(await findRowAction(/Archive/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Delete draft/ })).not.toBeInTheDocument();
  });

  it('deletes a draft after confirmation and reloads the list', async () => {
    vi.mocked(deleteGlobalAnnouncement).mockResolvedValue({ message: 'Deleted.' });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(await findRowAction(/Delete draft/));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this draft?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));

    await waitFor(() => expect(deleteGlobalAnnouncement).toHaveBeenCalledWith(5));
    await waitFor(() => expect(getGlobalAnnouncements).toHaveBeenCalledTimes(2));
  });

  it('shows the server message when the announcement cannot be deleted', async () => {
    vi.mocked(deleteGlobalAnnouncement).mockRejectedValue({ response: { status: 409, data: { message: 'Published announcements cannot be deleted. Archive them instead.' } } });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(await findRowAction(/Delete draft/));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this draft?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Published announcements cannot be deleted. Archive them instead.');
  });
});

describe('Official announcement photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGlobalAnnouncements).mockResolvedValue({ data: [], total: 0, current_page: 1, last_page: 1 });
    URL.createObjectURL = vi.fn(() => 'blob:announcement-photo');
    URL.revokeObjectURL = vi.fn();
  });

  it('previews and submits a photo with the official notice', async () => {
    vi.mocked(createGlobalAnnouncement).mockResolvedValue({ id: 1 });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create official notice' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Campus assembly' } });
    const photo = new File(['photo'], 'assembly.png', { type: 'image/png' });
    fireEvent.change(within(dialog).getByLabelText('Photo (optional)'), { target: { files: [photo] } });
    expect(await within(dialog).findByRole('img', { name: 'Announcement photo preview' })).toHaveAttribute('src', 'blob:announcement-photo');
    fireEvent.submit(within(dialog).getByLabelText(/^Title/).closest('form'));
    await waitFor(() => expect(createGlobalAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ title: 'Campus assembly', target_scope: 'all_users', image: photo })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:announcement-photo');
  });

  it('shows upload validation errors in the editor', async () => {
    vi.mocked(createGlobalAnnouncement).mockRejectedValue({ response: { status: 422, data: { errors: { image: ['The photo is invalid.'] } } } });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create official notice' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.submit(within(dialog).getByLabelText(/^Title/).closest('form'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The photo is invalid.');
    expect(within(dialog).getByRole('button', { name: 'Save draft' })).not.toBeDisabled();
  });
});
