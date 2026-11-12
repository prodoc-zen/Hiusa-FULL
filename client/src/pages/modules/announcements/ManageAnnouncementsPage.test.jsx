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

// DataTable renders both the table and the phone row blocks, so a title button appears twice in jsdom.
const titleButton = async (name) => (await screen.findAllByRole('button', { name }))[0];

describe('ManageAnnouncementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 101, organization_id: 1 }));
    announcementMocks.getAnnouncements.mockResolvedValue({ data: list });
  });

  it('opens a drawer with the announcement details and keeps management actions in the row menu', async () => {
    renderPage();
    fireEvent.click(await titleButton('Campus update'));
    expect(await screen.findByRole('dialog', { name: 'Campus update' })).toBeInTheDocument();
    expect(screen.getByText('Room change')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Campus update' })[0]);
    expect(screen.getByRole('menuitem', { name: 'Edit announcement' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete announcement' })).toBeInTheDocument();
  });

  describe('edit poster', () => {
    const openEditDrawer = async () => {
      renderPage();
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Campus update' }))[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit announcement' }));
      return screen.findByRole('dialog', { name: 'Edit announcement' });
    };
    const poster = (bytes, type = 'image/png') => {
      const file = new File(['x'], 'new-poster.png', { type });
      Object.defineProperty(file, 'size', { value: bytes });
      return file;
    };

    it('replaces the poster with the chosen image when the changes are saved', async () => {
      announcementMocks.updateAnnouncement.mockResolvedValue({ data: record });
      const dialog = await openEditDrawer();
      const file = poster(1024);
      fireEvent.change(within(dialog).getByLabelText(/Poster or image/), { target: { files: [file] } });
      expect(within(dialog).getByText('new-poster.png')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(announcementMocks.updateAnnouncement).toHaveBeenCalledWith(7, expect.objectContaining({ imageFile: file })));
    });

    it('refuses a poster over 5 MB and saves nothing until a good one is chosen', async () => {
      announcementMocks.updateAnnouncement.mockResolvedValue({ data: record });
      const dialog = await openEditDrawer();
      const input = within(dialog).getByLabelText(/Poster or image/);
      fireEvent.change(input, { target: { files: [poster(6 * 1024 * 1024)] } });

      expect(within(dialog).getByRole('alert')).toHaveTextContent('The poster must be 5 MB or smaller.');
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      expect(announcementMocks.updateAnnouncement).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { files: [poster(1024)] } });
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    });

    it('limits the announcement text to 10,000 characters and counts them', async () => {
      const dialog = await openEditDrawer();
      const content = within(dialog).getByLabelText('Announcement content');
      expect(content).toHaveAttribute('maxlength', '10000');
      expect(within(dialog).getByText('11 of 10,000 characters')).toBeInTheDocument();
      fireEvent.change(content, { target: { value: 'Moved to room 4' } });
      expect(within(dialog).getByText('15 of 10,000 characters')).toBeInTheDocument();
    });
  });

  it('keeps a failed delete confirmation open and reports the error', async () => {
    announcementMocks.deleteAnnouncement.mockRejectedValue({ response: { data: { message: 'Deletion denied.' } } });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Campus update' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete announcement' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Deletion denied.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows each row as a block on a phone with Audience, no swipe hint and no Views column', async () => {
    announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...record, approval_status: 'pending', is_published: false }));
    const { container } = renderPage();
    await screen.findAllByText('Waiting for Admin approval');
    const cards = container.querySelector('[data-view="cards"]');
    expect(within(cards).getByText('Audience')).toBeInTheDocument();
    expect(within(cards).getByText('All Members')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Views' })).not.toBeInTheDocument();
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    expect(screen.queryByText(/Swipe horizontally/)).not.toBeInTheDocument();
  });

  it('has one h1 and no second heading above the list', async () => {
    renderPage();
    await titleButton('Campus update');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Announcement list' })).not.toBeInTheDocument();
  });

  it('puts New announcement in the header as the one primary action, linking to the create page', async () => {
    renderPage();
    await titleButton('Campus update');
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

    it('shows a stage chip on a row that is not published and none on a published row', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(...stages));
      renderPage();
      const row = async (name) => within((await titleButton(name)).closest('div'));
      expect((await row('Draft post')).getByText('Draft')).toBeInTheDocument();
      expect((await row('Pending post')).getByText('Waiting for Admin approval')).toBeInTheDocument();
      expect((await row('Returned post')).getByText('Returned')).toBeInTheDocument();
      expect((await row('Live post')).queryByText('Published')).not.toBeInTheDocument();
    });

    it('marks a published post that students cannot see yet or any more', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(
        { ...record, id: 5, title: 'Later post', scheduled_at: '2099-01-05T04:00:00Z' },
        { ...record, id: 6, title: 'Old post', expires_at: '2020-03-02T04:00:00Z' },
        { ...record, id: 8, title: 'Open post', scheduled_at: '2020-01-05T04:00:00Z', expires_at: '2099-03-02T04:00:00Z' },
      ));
      renderPage();
      const row = async (name) => within((await titleButton(name)).closest('div'));
      expect((await row('Later post')).getByText('Scheduled for Jan 5, 2099')).toBeInTheDocument();
      expect((await row('Old post')).getByText('Expired Mar 2, 2020')).toBeInTheDocument();
      expect((await row('Open post')).queryByText(/Scheduled|Expired/)).not.toBeInTheDocument();
    });

    it('tells an officer a pending announcement waits for the Admin, with no button', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(stages[1]));
      renderPage();
      fireEvent.click(await titleButton('Pending post'));
      const status = screen.getAllByRole('status').find((node) => node.textContent.includes('No action needed from you.'));
      expect(status).toHaveTextContent('Waiting for Admin approval');
      expect(status).toHaveTextContent('Owner: Admin');
      expect(within(status).queryByRole('button')).not.toBeInTheDocument();
      expect(within(status).queryByRole('link')).not.toBeInTheDocument();
    });

    it('says in the header that an officer announcement goes to the Admin for approval', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      renderPage();
      await titleButton('Campus update');
      expect(screen.getByText(/goes to the Admin for approval before it is published/)).toBeInTheDocument();
      expect(screen.queryByText('Needs Admin approval')).not.toBeInTheDocument();
    });

    it('sends the Admin to Approvals to review a pending announcement', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[1], created_by: 202 }));
      renderPage();
      fireEvent.click(await titleButton('Pending post'));
      const link = screen.getByRole('link', { name: 'Review this announcement' });
      expect(link).toHaveAttribute('href', '/dashboard/approvals');
    });

    it('opens the approval record when the announcement carries its approval id', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[1], created_by: 202, approval_id: 58 }));
      renderPage();
      fireEvent.click(await titleButton('Pending post'));
      expect(screen.getByRole('link', { name: 'Review this announcement' })).toHaveAttribute('href', '/dashboard/approvals?record=58');
    });

    it('shows an officer why an announcement was returned and lets them edit it', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[3], review_remarks: 'Add the venue.' }));
      renderPage();
      fireEvent.click(await titleButton('Returned post'));
      expect(screen.getByText('Returned by the Admin')).toBeInTheDocument();
      expect(screen.getByText(/Add the venue\. Edit it to send it for approval again\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Edit announcement' }));
      expect(await screen.findByRole('dialog', { name: 'Edit announcement' })).toBeInTheDocument();
    });

    it('lets the Admin publish a draft from its next step', async () => {
      announcementMocks.getAnnouncements.mockResolvedValue(listOf(stages[0]));
      renderPage();
      fireEvent.click(await titleButton('Draft post'));
      fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));
      expect(await screen.findByRole('dialog', { name: 'Publish announcement' })).toBeInTheDocument();
    });

    it('names who can change a published announcement the viewer cannot edit', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', school_id: 101 }));
      announcementMocks.getAnnouncements.mockResolvedValue(listOf({ ...stages[2], created_by: 202 }));
      renderPage();
      fireEvent.click(await titleButton('Live post'));
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
      await titleButton('Campus update');
      fireEvent.change(screen.getByPlaceholderText('Search title, content, or author'), { target: { value: 'zzz' } });
      expect(await screen.findByText('No announcements match these filters')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await titleButton('Campus update')).toBeInTheDocument();
    });
  });
});
