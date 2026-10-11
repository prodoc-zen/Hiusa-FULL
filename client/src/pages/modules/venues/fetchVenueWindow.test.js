import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWindowBookings } from './fetchVenueWindow';

const mocks = vi.hoisted(() => ({ getVenueBookings: vi.fn() }));
vi.mock('../../../services/venueService', () => mocks);

const row = (id, status) => ({ id, status, venue_id: 8 });

function serve(rowsByStatus, lastPageByStatus) {
  mocks.getVenueBookings.mockImplementation(({ status, page }) => {
    const rows = rowsByStatus[status];
    const lastPage = lastPageByStatus[status];
    return Promise.resolve({ data: { data: rows.filter((entry) => entry.page === page).map(({ id, st }) => row(id, st)), total: rows.length, current_page: page, last_page: lastPage } });
  });
}

describe('fetchWindowBookings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('walks every page for both statuses so no booking is silently missing', async () => {
    serve({
      pending: [{ id: 1, st: 'pending', page: 1 }, { id: 2, st: 'pending', page: 2 }, { id: 3, st: 'pending', page: 3 }],
      approved: [{ id: 10, st: 'approved', page: 1 }, { id: 11, st: 'approved', page: 2 }],
    }, { pending: 3, approved: 2 });

    const result = await fetchWindowBookings({ from: '2026-10-05T00:00:00+08:00', to: '2026-10-11T23:59:59+08:00', venueId: '8' });

    expect(result.items.map((item) => item.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 10, 11]);
    expect(result.truncated).toBeNull();
    const calls = mocks.getVenueBookings.mock.calls.map(([params]) => `${params.status}:${params.page}`).sort();
    expect(calls).toEqual(['approved:1', 'approved:2', 'pending:1', 'pending:2', 'pending:3']);
    expect(mocks.getVenueBookings).toHaveBeenCalledWith({ from: '2026-10-05T00:00:00+08:00', to: '2026-10-11T23:59:59+08:00', status: 'pending', venue_id: '8', page: 1, per_page: 100 });
  });

  it('counts a booking the server repeats on two pages once and still reports the ones it never returned', async () => {
    mocks.getVenueBookings.mockImplementation(({ status, page }) => {
      const pages = { 1: [row(1, status), row(2, status)], 2: [row(2, status), row(3, status)] };
      return Promise.resolve({ data: { data: status === 'pending' ? pages[page] : [], total: status === 'pending' ? 5 : 0, current_page: page, last_page: status === 'pending' ? 2 : 1 } });
    });

    const result = await fetchWindowBookings({ from: 'a', to: 'b' });

    const ids = result.items.map((item) => item.id);
    expect(ids.sort()).toEqual([1, 2, 3]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.truncated).toEqual({ shown: 3, total: 5 });
  });

  it('asks for every venue when none is chosen', async () => {
    serve({ pending: [], approved: [] }, { pending: 1, approved: 1 });
    await fetchWindowBookings({ from: 'a', to: 'b', venueId: '' });
    expect(mocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ venue_id: undefined }));
  });

  it('says so when the page ceiling stops the walk instead of dropping bookings quietly', async () => {
    mocks.getVenueBookings.mockImplementation(({ page }) => Promise.resolve({ data: { data: [row(page, 'pending')], total: 9000, current_page: page, last_page: 90 } }));
    const result = await fetchWindowBookings({ from: 'a', to: 'b' });
    expect(result.truncated).toEqual({ shown: 100, total: 18000 });
    expect(mocks.getVenueBookings).toHaveBeenCalledTimes(100);
  });
});
