import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecentActivity from './RecentActivity';
import { getMyActivity } from '../../services/profileService';

vi.mock('../../services/profileService', () => ({ getMyActivity: vi.fn() }));

const entry = (id, action) => ({ id, module: 'event_registrations', module_label: 'Event Registrations', action_label: action, record_label: `Event Registration #${id}`, created_at: '2026-10-01T08:00:00Z' });

describe('RecentActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the person\'s own actions and loads more on request', async () => {
    vi.mocked(getMyActivity)
      .mockResolvedValueOnce({ data: { data: [entry(2, 'Registered')], current_page: 1, last_page: 2, total: 2 } })
      .mockResolvedValueOnce({ data: { data: [entry(1, 'Cancelled')], current_page: 2, last_page: 2, total: 2 } });
    render(<RecentActivity />);

    expect(await screen.findByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(getMyActivity).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('explains an empty history', async () => {
    vi.mocked(getMyActivity).mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0 } });
    render(<RecentActivity />);

    expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it('offers a retry when the history cannot load', async () => {
    vi.mocked(getMyActivity).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { data: [entry(3, 'Submitted')], current_page: 1, last_page: 1, total: 1 } });
    render(<RecentActivity />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(getMyActivity).toHaveBeenLastCalledWith(1);
  });
});
