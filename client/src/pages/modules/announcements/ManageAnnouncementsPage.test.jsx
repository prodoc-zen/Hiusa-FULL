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
const listOf = (...data) => ({ data: { data, total: data.length, current_page: 1, last_page: 1, per_page: 20, summary: { total: data.length, published: 0, unpublished: 0, pending: 0, views: 0 } } });
const renderPage = () => render(<MemoryRouter initialEntries={['/dashboard/announcements/manage-announcements']}><ManageAnnouncementsPage /></MemoryRouter>);

describe('ManageAnnouncementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 101, organization_id: 1 }));
    announcementMocks.getAnnouncements.mockResolvedValue({ data: list });
  });

  it('expands a row to show announcement details and management actions', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Campus Update' }));
    expect(screen.getByText('Room change')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Campus update' }));
    expect(screen.getByRole('menuitem', { name: 'Edit announcement' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete announcement' })).toBeInTheDocument();
  });

  it('keeps a failed delete confirmation open and reports the error', async () => {
    announcementMocks.deleteAnnouncement.mockRejectedValue({ response: { data: { message: 'Deletion denied.' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Campus update' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete announcement' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Deletion denied.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('puts New announcement in the header as the one primary action, linking to the create page', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Campus Update' });
    expect(screen.getByRole('heading', { level: 1, name: 'Announcements' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'New announcement' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
    expect(screen.queryByRole('button', { name: 'Create announcement' })).not.toBeInTheDocument();
  });

  it('shows the header while the list loads', () => {
    announcementMocks.getAnnouncements.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Announcements' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New announcement' })).toBeInTheDocument();
  });

  describe('approval stage', () => {
    const stages = [
      { ...record, id: 1, title: 'Draft post', approval_status: 'draft', is_published: false },
      { ...record, id: 2, title: 'Pending post', approval_status: 'pending', is_published: false },
      { ...record, id: 3, title: 'Live post', approval_status: 'approved', is_published: true },
      { ...record, id: 4, title: 'Returned post', approval_status: 'rejected', is_published: false },
    ];

    it('shows a stage chip with text on every row', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(...stages));
      renderPage();
      const row = async (name) => within((await screen.findByRole('button', { name })).closest('tr'));
      expect((await row('Draft Post')).getByText('Draft')).toBeInTheDocument();
      expect((await row('Pending Post')).getByText('Waiting for Admin approval')).toBeInTheDocument();
      expect((await row('Live Post')).getByText('Published')).toBeInTheDocument();
      expect((await row('Returned Post')).getByText('Returned')).toBeInTheDocument();
    });

    it('tells an officer a pending announcement waits for the Admin, with no button', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(stages[1]));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Pending Post' }));
      const status = screen.getAllByRole('status').find((node) => node.textContent.includes('No action needed from you.'));
      expect(status).toHaveTextContent('Waiting for Admin approval');
      expect(status).toHaveTextContent('Owner: Admin');
      expect(within(status).queryByRole('button')).not.toBeInTheDocument();
      expect(within(status).queryByRole('link')).not.toBeInTheDocument();
    });

    it('says in the header that an officer announcement goes to the Admin for approval', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      renderPage();
      await screen.findByRole('button', { name: 'Campus Update' });
      expect(screen.getByText(/goes to the Admin for approval before it is published/)).toBeInTheDocument();
      expect(screen.getByText('Needs Admin approval')).toBeInTheDocument();
    });

    it('sends the Admin to Approvals to review a pending announcement', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[1], created_by: 202 }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Pending Post' }));
      const link = screen.getByRole('link', { name: 'Review this announcement' });
      expect(link).toHaveAttribute('href', '/dashboard/approvals');
    });

    it('shows an officer why an announcement was returned and lets them edit it', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[3], review_remarks: 'Add the venue.' }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Returned Post' }));
      expect(screen.getByText('Returned by the Admin')).toBeInTheDocument();
      expect(screen.getByText(/Add the venue\. Edit it to send it for approval again\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Edit announcement' }));
      expect(await screen.findByRole('dialog', { name: 'Edit announcement' })).toBeInTheDocument();
    });

    it('lets the Admin publish a draft from its next step', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(stages[0]));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Draft Post' }));
      fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));
      expect(await screen.findByRole('dialog', { name: 'Publish announcement' })).toBeInTheDocument();
    });

    it('names who can change a published announcement the viewer cannot edit', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[2], created_by: 202 }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Live Post' }));
      expect(screen.getByText('Only its author or the Admin can change it.')).toBeInTheDocument();
    });
  });

  describe('empty states', () => {
    it('asks the Admin to write the first announcement', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf());
      renderPage();
      expect(await screen.findByText('No announcements yet')).toBeInTheDocument();
      expect(screen.queryByText('No announcements match these filters')).not.toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'New announcement' })).toHaveLength(2);
    });

    it('tells an officer the first announcement goes to the Admin for approval', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf());
      renderPage();
      expect(await screen.findByText('Write your first announcement. It goes to the Admin for approval before it is published.')).toBeInTheDocument();
    });

    it('offers Clear filters when a search finds nothing', async () => {
      announcementMocks.getAnnouncements.mockImplementation((params) => Promise.resolve(params.search ? listOf() : { data: list }));
      renderPage();
      await screen.findByRole('button', { name: 'Campus Update' });
      fireEvent.change(screen.getByPlaceholderText('Search title, content, or author'), { target: { value: 'zzz' } });
      expect(await screen.findByText('No announcements match these filters')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await screen.findByRole('button', { name: 'Campus Update' })).toBeInTheDocument();
    });
  });
});
