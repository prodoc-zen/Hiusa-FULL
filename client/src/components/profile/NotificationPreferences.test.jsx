import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationPreferences from './NotificationPreferences';
import { getNotificationPreferences, updateNotificationPreferences } from '../../services/profileService';

vi.mock('../../services/profileService', () => ({ getNotificationPreferences: vi.fn(), updateNotificationPreferences: vi.fn() }));
vi.mock('../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const MUTABLE = ['announcement', 'event', 'election', 'merchandise'];

describe('NotificationPreferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows each informational kind as a switch that is on unless muted', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue({ data: { muted: ['merchandise'], mutable: MUTABLE } });
    render(<NotificationPreferences />);

    expect(await screen.findByRole('switch', { name: /Announcements/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Merchandise orders/ })).not.toBeChecked();
    expect(screen.getByText(/always show, because someone is waiting on them/)).toBeInTheDocument();
  });

  it('saves a change and rolls it back if the save fails', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue({ data: { muted: [], mutable: MUTABLE } });
    vi.mocked(updateNotificationPreferences)
      .mockResolvedValueOnce({ data: { muted: ['event'], mutable: MUTABLE } })
      .mockRejectedValueOnce(new Error('offline'));
    render(<NotificationPreferences />);

    fireEvent.click(await screen.findByRole('switch', { name: /Events and reminders/ }));
    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledWith(['event']));
    await waitFor(() => expect(screen.getByRole('switch', { name: /Events and reminders/ })).not.toBeChecked());

    fireEvent.click(screen.getByRole('switch', { name: /Elections/ }));
    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenLastCalledWith(['event', 'election']));
    await waitFor(() => expect(screen.getByRole('switch', { name: /Elections/ })).toBeChecked());
  });
});
