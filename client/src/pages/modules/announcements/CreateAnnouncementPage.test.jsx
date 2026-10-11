import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateAnnouncementPage from './CreateAnnouncementPage';
import { createAnnouncement } from '../../../services/announcementService';

vi.mock('../../../services/announcementService', () => ({
  createAnnouncement: vi.fn(),
  generateAnnouncementDraft: vi.fn(),
  getAnnouncementGenerationQuota: vi.fn(() => Promise.resolve({ data: { limit: 20, used: 3, remaining: 17 } })),
}));

function signInAs(role) {
  localStorage.setItem('user', JSON.stringify({ school_id: 1, role }));
}

async function fillAndStart(buttonName) {
  render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
  fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  return screen.findByRole('dialog');
}

describe('CreateAnnouncementPage', () => {
  beforeEach(() => {
    vi.mocked(createAnnouncement).mockResolvedValue({ data: { id: 5 } });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders a responsive editor workspace with accessible publishing controls', async () => {
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);

    expect(screen.queryByRole('heading', { name: 'Create Announcement' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Instructions for AI draft/)).toBeInTheDocument();
    expect(screen.getByLabelText('Audience')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByText('Publishing settings')).toBeInTheDocument();
    expect(await screen.findByText('17 of 20 drafts left today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });

    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeEnabled();
    expect(screen.getByText('24 characters')).toBeInTheDocument();
  });

  it('tells an Officer the announcement goes to the Admin for approval before members see it', async () => {
    signInAs('SBO_OFFICER');
    const dialog = await fillAndStart('Submit for approval');

    expect(screen.queryByRole('button', { name: 'Publish Now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Draft' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Admin approves it before members see it/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/publish/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for approval' }));

    expect(await screen.findByRole('heading', { name: 'Sent to your Admin for approval' })).toBeInTheDocument();
    expect(screen.getByText(/once the Admin approves it/)).toHaveTextContent('It goes to All Members once the Admin approves it.');
    expect(screen.queryByText(/Announcement Posted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sent to All Members/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View in Announcements' })).toHaveAttribute('href', '/dashboard/announcements/manage-announcements');
    expect(createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ title: 'General Assembly', is_published: true }));
  });

  it('keeps the immediate-publish wording for an Admin and links back to the list', async () => {
    signInAs('ADMIN');
    const dialog = await fillAndStart('Publish Now');

    expect(within(dialog).getByText('Are you sure you want to publish this announcement now?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish Now' }));

    expect(await screen.findByRole('heading', { name: 'Announcement Posted!' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Sent to/)).toHaveTextContent('Sent to All Members.'));
    expect(screen.getByRole('link', { name: 'View in Announcements' })).toHaveAttribute('href', '/dashboard/announcements/manage-announcements');
  });
});
