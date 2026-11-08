import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('keeps a single header action so the row fits a phone, with off campus chosen in the form', async () => {
    render(<MemoryRouter><VenueBookingPage /></MemoryRouter>);
    await screen.findByText(/Reserved by Your organization/);
    expect(screen.queryByRole('button', { name: 'Request an off-campus venue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Request a venue' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Request a venue booking' });
    expect(within(dialog).getByLabelText('Venue type')).toBeInTheDocument();
  });

  it('offers one request button, with no second one beside the calendar', async () => {
    render(<MemoryRouter><VenueBookingPage /></MemoryRouter>);
    await screen.findByText(/Reserved by Your organization/);
    expect(screen.getAllByRole('button', { name: /^Request/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Request this venue' })).not.toBeInTheDocument();
  });

  it('moves the availability window a week at a time without native date fields', async () => {
    render(<MemoryRouter><VenueBookingPage /></MemoryRouter>);
    await screen.findByText(/Reserved by Your organization/);
    expect(screen.getByText('Oct 7 - Oct 14, 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByText('Oct 14 - Oct 21, 2026')).toBeInTheDocument();
    await waitFor(() => expect(venueMocks.getVenueAvailability).toHaveBeenLastCalledWith('8', { from: '2026-10-14', to: '2026-10-21' }));
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeEnabled();
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  });
});
