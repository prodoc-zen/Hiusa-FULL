import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VenueBookingPage from './VenueBookingPage';

const venueMocks = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueBookings: vi.fn(),
  getVenueAvailability: vi.fn(),
}));

vi.mock('../../../services/venueService', () => ({
  ...venueMocks,
  createVenueBooking: vi.fn(),
  withdrawVenueBooking: vi.fn(),
}));

vi.mock('../../../services/eventService', () => ({
  getEvents: vi.fn(() => Promise.resolve({ data: [] })),
}));

describe('VenueBookingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T04:00:00Z'));
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    venueMocks.getVenues.mockResolvedValue({ data: [{ id: 8, name: 'Main Hall', location: 'Campus', capacity: 100, is_active: true }] });
    venueMocks.getVenueBookings.mockResolvedValue({ data: { data: [], total: 0, current_page: 1, last_page: 1 } });
    venueMocks.getVenueAvailability.mockResolvedValue({ data: [
      { id: 1, start_time: '2026-10-07T01:00:00Z', end_time: '2026-10-07T03:00:00Z', status: 'approved', reserved_by: 'Your organization' },
    ] });
  });

  afterEach(() => vi.useRealTimers());

  it('still renders the availability timeline for the chosen venue', async () => {
    render(<MemoryRouter><VenueBookingPage /></MemoryRouter>);
    expect(await screen.findByText(/Reserved by Your organization/)).toBeInTheDocument();
    await waitFor(() => expect(venueMocks.getVenueAvailability).toHaveBeenCalledWith('8', { from: '2026-10-07', to: '2026-10-14' }));
    expect(screen.getByLabelText('Booking hours, 5 AM to 10 PM')).toBeInTheDocument();
  });
});
