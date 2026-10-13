import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalAnnouncementsPage from './GlobalAnnouncementsPage';

const mocks = vi.hoisted(() => ({ getGlobalAnnouncements: vi.fn(), getSystemOrganizations: vi.fn(), createGlobalAnnouncement: vi.fn(), updateGlobalAnnouncement: vi.fn(), archiveGlobalAnnouncement: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => mocks);

describe('Official announcement photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGlobalAnnouncements.mockResolvedValue({ data: [], total: 0, current_page: 1, last_page: 1, per_page: 10 });
    mocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 3, acronym: 'CC', college: 'Computing' }], current_page: 1, last_page: 1 });
    URL.createObjectURL = vi.fn(() => 'blob:announcement-photo');
    URL.revokeObjectURL = vi.fn();
  });

  it('previews and submits a photo with the official notice', async () => {
    mocks.createGlobalAnnouncement.mockResolvedValue({ id: 1 });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create official notice' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Campus assembly' } });
    const photo = new File(['photo'], 'assembly.png', { type: 'image/png' });
    fireEvent.change(within(dialog).getByLabelText('Photo (optional)'), { target: { files: [photo] } });
    expect(await within(dialog).findByRole('img', { name: 'Announcement photo preview' })).toHaveAttribute('src', 'blob:announcement-photo');
    fireEvent.submit(within(dialog).getByLabelText(/^Title/).closest('form'));
    await waitFor(() => expect(mocks.createGlobalAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ title: 'Campus assembly', target_scope: 'all_users', image: photo })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:announcement-photo');
  });

  it('reports server upload validation errors in the editor', async () => {
    mocks.createGlobalAnnouncement.mockRejectedValue({ response: { status: 422, data: { errors: { image: ['The photo is invalid.'] } } } });
    render(<GlobalAnnouncementsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create official notice' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.submit(within(dialog).getByLabelText(/^Title/).closest('form'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The photo is invalid.');
    expect(within(dialog).getByRole('button', { name: 'Save draft' })).not.toBeDisabled();
  });
});
