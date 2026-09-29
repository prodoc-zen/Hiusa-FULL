import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageAnnouncementsPage from './ManageAnnouncementsPage';

const announcementMocks = vi.hoisted(() => ({
  getAnnouncements: vi.fn(),
  updateAnnouncement: vi.fn(),
  togglePublish: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));
vi.mock('../../../services/announcementService', () => announcementMocks);

const record = { id: 7, title: 'Campus update', body: 'Room change', target_role: 'all', category: 'general', approval_status: 'approved', is_published: true, views_count: 2, created_by: 101, organization_id: 1, created_at: '2026-09-01T08:00:00Z', creator: { first_name: 'Ana', last_name: 'Reyes' } };
const list = { data: [record], total: 1, current_page: 1, last_page: 1, per_page: 20, summary: { total: 1, published: 1, unpublished: 0, pending: 0, views: 2 } };

describe('ManageAnnouncementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 101, organization_id: 1 }));
    announcementMocks.getAnnouncements.mockResolvedValue({ data: list });
  });

  it('shows the published feed preview alongside management actions', async () => {
    render(<MemoryRouter><ManageAnnouncementsPage /></MemoryRouter>);
    const preview = await screen.findByRole('complementary', { name: 'Announcement feed preview' });
    expect(await within(preview).findByText('Campus update')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Campus update' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Campus update' })).toBeInTheDocument();
  });

  it('keeps a failed delete confirmation open and reports the error', async () => {
    announcementMocks.deleteAnnouncement.mockRejectedValue({ response: { data: { message: 'Deletion denied.' } } });
    render(<MemoryRouter><ManageAnnouncementsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Campus update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Deletion denied.'));
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeInTheDocument();
  });
});
