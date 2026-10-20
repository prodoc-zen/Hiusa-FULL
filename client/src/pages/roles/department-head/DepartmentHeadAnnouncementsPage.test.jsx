import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentHeadAnnouncementsPage from './DepartmentHeadAnnouncementsPage';

const announcements = vi.hoisted(() => ({ getAnnouncements: vi.fn(), createAnnouncement: vi.fn(), updateAnnouncement: vi.fn(), deleteAnnouncement: vi.fn(), togglePublish: vi.fn() }));
const organizations = vi.hoisted(() => ({ getCollegeOrganizations: vi.fn() }));
vi.mock('../../../services/announcementService', () => announcements);
vi.mock('../../../services/collegeOrganizationService', () => organizations);
const org = { id: 7, name: 'Computing Society', is_active: true };
const post = { id: 11, title: 'Orientation', body: 'Meet in the office.', organization_id: 7, organization: org, target_role: 'all', category: 'general', is_published: false };
const pageOf = (rows, extra = {}) => ({ data: { data: rows, current_page: 1, last_page: 1, per_page: 10, total: rows.length, ...extra } });
const renderPage = () => render(<MemoryRouter><DepartmentHeadAnnouncementsPage /></MemoryRouter>);
async function openForm() {
  fireEvent.click(screen.getByRole('button', { name: 'New announcement' }));
  await screen.findByRole('option', { name: org.name });
  fireEvent.change(screen.getByLabelText(/Organization/), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'College orientation' } });
  fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'Meet in the office.' } });
}
async function action(name) {
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Orientation' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
describe('Department Head announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    announcements.getAnnouncements.mockResolvedValue(pageOf([post]));
    organizations.getCollegeOrganizations.mockResolvedValue(pageOf([org]));
    announcements.createAnnouncement.mockResolvedValue({ data: post });
  });
  it('publishes to the chosen organization and refreshes the managed list', async () => {
    renderPage();
    await screen.findByText('Orientation');
    expect(announcements.getAnnouncements).toHaveBeenCalledWith({ managed: 1, page: 1, per_page: 10 });
    expect(organizations.getCollegeOrganizations).not.toHaveBeenCalled();
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));
    await waitFor(() => expect(announcements.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 7, is_published: true, title: 'College orientation' })));
    expect(await screen.findByText('Announcement published to the selected organization.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('saves a draft and preserves entered fields after validation fails', async () => {
    announcements.createAnnouncement.mockRejectedValueOnce({ response: { status: 422, data: { message: 'Please correct the title.', errors: { title: ['Title already exists.'] } } } });
    renderPage();
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect((await screen.findAllByText('Title already exists.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Message/)).toHaveValue('Meet in the office.');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(announcements.createAnnouncement).toHaveBeenLastCalledWith(expect.objectContaining({ is_published: false })));
  });
  it('edits only content, publishes a draft, and confirms deletion', async () => {
    announcements.updateAnnouncement.mockResolvedValue({ data: post });
    announcements.togglePublish.mockResolvedValue({ data: post });
    announcements.deleteAnnouncement.mockResolvedValue({});
    renderPage();
    await action('Edit announcement');
    expect(screen.getByLabelText(/Organization/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Updated orientation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(announcements.updateAnnouncement).toHaveBeenCalledWith(11, expect.objectContaining({ title: 'Updated orientation' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await action('Publish');
    await waitFor(() => expect(announcements.togglePublish).toHaveBeenCalledWith(11));
    await action('Delete announcement');
    expect(announcements.deleteAnnouncement).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete announcement?' })).getByRole('button', { name: 'Delete announcement' }));
    await waitFor(() => expect(announcements.deleteAnnouncement).toHaveBeenCalledWith(11));
  });
  it('pages announcements and recovers from an organization lookup error', async () => {
    announcements.getAnnouncements.mockResolvedValue(pageOf([post], { total: 12, last_page: 2 }));
    organizations.getCollegeOrganizations.mockRejectedValueOnce(new Error('Unavailable'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Next page of announcements' }));
    await waitFor(() => expect(announcements.getAnnouncements).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: org.name })).toBeInTheDocument();
  });
});
