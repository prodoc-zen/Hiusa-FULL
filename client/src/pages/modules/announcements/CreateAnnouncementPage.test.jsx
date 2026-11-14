import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateAnnouncementPage from './CreateAnnouncementPage';
import { createAnnouncement, generateAnnouncementDraft, getAnnouncementGenerationQuota } from '../../../services/announcementService';

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
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeEnabled();

    // An incomplete form says what is missing beside each field and opens no dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    expect(screen.getByText('Enter a title.')).toBeInTheDocument();
    expect(screen.getByText('Write the announcement text.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Add a title and content to continue/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });

    expect(screen.queryByText('Enter a title.')).not.toBeInTheDocument();
    expect(screen.getByText('24 of 10,000 characters')).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/)).toHaveAttribute('maxlength', '10000');
    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('says plainly when the generated text is a template draft', async () => {
    vi.mocked(generateAnnouncementDraft).mockResolvedValue({ data: {
      output_text: 'General Assembly. Please be informed.',
      ai_output_id: 9,
      is_template: true,
      notice: 'This is a template draft because the AI writer is not available right now. Add the date, place and other details before you post it.',
      quota: { limit: 20, used: 4, remaining: 16 },
    } });
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));

    expect(await screen.findByRole('status')).toHaveTextContent('This is a template draft');
    expect(screen.getByLabelText(/Content/)).toHaveValue('General Assembly. Please be informed.');
  });

  it('asks before replacing written text and keeps it when the writer says cancel', async () => {
    vi.mocked(generateAnnouncementDraft).mockResolvedValue({ data: { output_text: 'Drafted text.', ai_output_id: 9, is_template: false } });
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'My own words.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));

    const dialog = await screen.findByRole('dialog');
    expect(generateAnnouncementDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/Content/)).toHaveValue('My own words.');

    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace text' }));
    await waitFor(() => expect(screen.getByLabelText(/Content/)).toHaveValue('Drafted text.'));
  });

  it('does not clear the text when the response has no draft', async () => {
    vi.mocked(generateAnnouncementDraft).mockResolvedValue({ data: {} });
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'My own words.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace text' }));
    await waitFor(() => expect(generateAnnouncementDraft).toHaveBeenCalled());
    expect(screen.getByLabelText(/Content/)).toHaveValue('My own words.');
  });

  it('shows no made-up count when the quota request fails and caps the instructions', async () => {
    vi.mocked(getAnnouncementGenerationQuota).mockRejectedValueOnce(new Error('offline'));
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);

    expect(await screen.findByText('Daily limit unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/of 20 drafts left/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Instructions for AI draft/)).toHaveAttribute('maxlength', '2000');
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
  });

  it('words the request route as a request for an Officer and as a new announcement for an Admin', () => {
    signInAs('SBO_OFFICER');
    const view = render(<MemoryRouter initialEntries={['/dashboard/approval-requests/new/announcement']}><CreateAnnouncementPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Announcement request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    expect(screen.queryByText(/Publish now|without notifying/)).not.toBeInTheDocument();
    view.unmount();
    signInAs('ADMIN');
    render(<MemoryRouter initialEntries={['/dashboard/approval-requests/new/announcement']}><CreateAnnouncementPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'New announcement' })).toBeInTheDocument();
    expect(screen.queryByText('Announcement request')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeInTheDocument();
  });

  it('stacks Publish now and Save draft without letting flex-1 collapse them below their 40px height', () => {
    signInAs('ADMIN');
    render(<MemoryRouter initialEntries={['/dashboard/announcements/create-announcement']}><CreateAnnouncementPage /></MemoryRouter>);

    const row = screen.getByRole('button', { name: 'Publish now' }).parentElement;
    expect(row.className).toContain('lg:flex-col');
    expect(row.className).toContain('max-lg:[&>*]:flex-1');
    expect(row.className).not.toMatch(/(^|\s)\[&>\*\]:flex-1/);
    expect(screen.getByRole('button', { name: 'Publish now' }).className).toContain('h-10');
  });

  it('tells an Officer the announcement goes to the Admin for approval before members see it', async () => {
    signInAs('SBO_OFFICER');
    const dialog = await fillAndStart('Submit for approval');

    expect(screen.queryByRole('button', { name: 'Publish now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Admin approves it before members see it/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/publish/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for approval' }));

    expect(await screen.findByRole('heading', { name: 'Sent to your Admin for approval' })).toBeInTheDocument();
    expect(screen.getByText(/once the Admin approves it/)).toHaveTextContent('It goes to All Members once the Admin approves it.');
    expect(screen.queryByText(/Announcement posted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sent to All Members/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View in announcements' })).toHaveAttribute('href', '/dashboard/announcements/manage-announcements');
    expect(createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ title: 'General Assembly', is_published: true }));
  });

  it('keeps the immediate-publish wording for an Admin and links back to the list', async () => {
    signInAs('ADMIN');
    const dialog = await fillAndStart('Publish now');

    expect(within(dialog).getByText('Are you sure you want to publish this announcement now?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish now' }));

    expect(await screen.findByRole('heading', { name: 'Announcement posted' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Sent to/)).toHaveTextContent('Sent to All Members.'));
    expect(screen.getByRole('link', { name: 'View in announcements' })).toHaveAttribute('href', '/dashboard/announcements/manage-announcements');
  });

  describe('poster picker', () => {
    function pick(input, file) {
      fireEvent.change(input, { target: { files: [file] } });
    }
    function bigFile(type, bytes) {
      const file = new File(['x'], 'poster', { type });
      Object.defineProperty(file, 'size', { value: bytes });
      return file;
    }

    it('refuses a file that is not a JPEG, PNG or WebP at once, under the field', () => {
      const { container } = render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
      const input = container.querySelector('#announcement-image');

      pick(input, new File(['%PDF'], 'poster.pdf', { type: 'application/pdf' }));

      expect(screen.getByRole('alert')).toHaveTextContent('The poster must be a JPEG, PNG or WebP image.');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText('poster.pdf')).not.toBeInTheDocument();
      expect(screen.getByText('Choose an image')).toBeInTheDocument();
    });

    it('refuses an image over 5 MB at once and accepts one at exactly 5 MB', async () => {
      const { container } = render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
      const input = container.querySelector('#announcement-image');

      pick(input, bigFile('image/png', 5 * 1024 * 1024 + 1));
      expect(screen.getByRole('alert')).toHaveTextContent('The poster must be 5 MB or smaller.');
      expect(screen.getByText('Choose an image')).toBeInTheDocument();

      pick(input, bigFile('image/webp', 5 * 1024 * 1024));
      expect(screen.queryByText('The poster must be 5 MB or smaller.')).not.toBeInTheDocument();
      expect(screen.getByText('poster')).toBeInTheDocument();
      expect(input).not.toHaveAttribute('aria-invalid');
    });

    it('saves nothing while a refused file is showing, until a good image is chosen', async () => {
      const { container } = render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
      const input = container.querySelector('#announcement-image');
      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
      fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });

      pick(input, bigFile('image/png', 6 * 1024 * 1024));

      expect(screen.getByRole('alert')).toHaveTextContent('The poster must be 5 MB or smaller.');
      expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
      expect(createAnnouncement).not.toHaveBeenCalled();

      pick(input, bigFile('image/png', 4 * 1024 * 1024));
      expect(screen.getByRole('button', { name: 'Publish now' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    });

    it('lets the author post without a poster after a refused file, by saying so', async () => {
      const { container } = render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
      fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });
      pick(container.querySelector('#announcement-image'), new File(['GIF'], 'loop.gif', { type: 'image/gif' }));
      expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Post without a poster' }));
      fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish now' }));

      await waitFor(() => expect(createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ imageFile: null })));
    });

    it('drops an earlier good poster when a refused one is chosen after it', () => {
      const { container } = render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);
      const input = container.querySelector('#announcement-image');
      pick(input, bigFile('image/webp', 1024));
      expect(screen.getByText('poster')).toBeInTheDocument();

      pick(input, bigFile('image/png', 6 * 1024 * 1024));

      expect(screen.queryByText('poster')).not.toBeInTheDocument();
      expect(screen.getByText('Choose an image')).toBeInTheDocument();
    });
  });
});
