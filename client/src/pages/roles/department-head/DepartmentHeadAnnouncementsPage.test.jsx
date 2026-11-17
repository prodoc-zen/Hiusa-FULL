import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentHeadAnnouncementsPage from './DepartmentHeadAnnouncementsPage';

const announcements = vi.hoisted(() => ({ getAnnouncements: vi.fn(), createAnnouncement: vi.fn(), updateAnnouncement: vi.fn(), deleteAnnouncement: vi.fn(), togglePublish: vi.fn(), generateAnnouncementDraft: vi.fn() }));
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
  fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Orientation' }))[0]);
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
    await screen.findAllByText('Orientation');
    expect(announcements.getAnnouncements).toHaveBeenCalledWith({ managed: 1, page: 1, per_page: 10 });
    expect(organizations.getCollegeOrganizations).not.toHaveBeenCalled();
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));
    await waitFor(() => expect(announcements.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 7, is_published: true, title: 'College orientation' })));
    expect(await screen.findByText('Announcement published to the selected organization.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('publishes to every active organization of the college when "All organizations in my college" is chosen', async () => {
    renderPage();
    await screen.findAllByText('Orientation');
    await openForm();
    fireEvent.change(screen.getByLabelText(/Organization/), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));
    await waitFor(() => expect(announcements.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'all', is_published: true })));
    expect(await screen.findByText('Announcement published to every active organization in your college.')).toBeInTheDocument();
  });
  it('does not offer the all-organizations choice when editing one announcement', async () => {
    renderPage();
    await action('Edit announcement');
    expect(screen.queryByRole('option', { name: 'All organizations in my college' })).not.toBeInTheDocument();
  });
  it('drafts the message with AI and sends the draft id with the announcement', async () => {
    announcements.generateAnnouncementDraft.mockResolvedValue({ data: { output_text: 'Orientation is in the main hall.', ai_output_id: 41, is_template: false } });
    renderPage();
    await screen.findAllByText('Orientation');
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }));
    await screen.findByRole('option', { name: org.name });
    fireEvent.change(screen.getByLabelText(/Organization/), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'College orientation' } });
    fireEvent.click(screen.getByText('Draft the message with AI'));
    fireEvent.change(screen.getByLabelText(/Instructions for the draft/), { target: { value: 'Main hall at 2 PM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
    await waitFor(() => expect(screen.getByLabelText(/Message/)).toHaveValue('Orientation is in the main hall.'));
    expect(announcements.generateAnnouncementDraft).toHaveBeenCalledWith({ title: 'College orientation', target_role: 'all', category: 'general', details: 'Main hall at 2 PM' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));
    await waitFor(() => expect(announcements.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ ai_output_id: 41, body: 'Orientation is in the main hall.' })));
  });
  it('asks before an AI draft replaces text already written, and shows the server reason when a draft is refused', async () => {
    announcements.generateAnnouncementDraft.mockRejectedValue({ response: { status: 429, data: { message: 'You have used all announcement drafts available today.' } } });
    renderPage();
    await screen.findAllByText('Orientation');
    await openForm();
    fireEvent.click(screen.getByText('Draft the message with AI'));
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
    expect(announcements.generateAnnouncementDraft).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Replace your text?' })).getByRole('button', { name: 'Replace text' }));
    expect((await screen.findAllByText('You have used all announcement drafts available today.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Message/)).toHaveValue('Meet in the office.');
  });
  it('limits the message to 10,000 characters and shows how many are used', async () => {
    renderPage();
    await openForm();
    expect(screen.getByLabelText(/Message/)).toHaveAttribute('maxLength', '10000');
    expect(screen.getByText('19 of 10,000 characters')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'x'.repeat(1234) } });
    expect(screen.getByText('1,234 of 10,000 characters')).toBeInTheDocument();
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
  it('says the college has not written any, points to the feed, and keeps the feed link in the header', async () => {
    announcements.getAnnouncements.mockResolvedValue(pageOf([]));
    renderPage();
    expect(await screen.findByText('You have not written any announcements')).toBeInTheDocument();
    expect(screen.getByText('Announcements from the organizations in your college are in the feed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View announcement feed' })).toHaveAttribute('href', '/dashboard/announcements/view-announcements');
    expect(screen.queryByText('No announcements yet')).not.toBeInTheDocument();
  });
  it('marks only a draft, beside its title, and leaves a published row unmarked', async () => {
    announcements.getAnnouncements.mockResolvedValue(pageOf([post, { ...post, id: 12, title: 'Enrollment', is_published: true }]));
    renderPage();
    await screen.findAllByText('Enrollment');
    expect(screen.getAllByText('Draft')).toHaveLength(2);
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
  });
});
