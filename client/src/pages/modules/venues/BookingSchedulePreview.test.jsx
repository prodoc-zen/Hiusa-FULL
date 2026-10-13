import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingSchedulePreview from './BookingSchedulePreview';
import { getVenueAvailability } from '../../../services/venueService';

vi.mock('../../../services/venueService', () => ({ getVenueAvailability: vi.fn() }));
const booking = { id: 1, venue_id: 3, venue: { name: 'Main Gym' }, start_time: '2026-10-16T09:00:00+08:00', end_time: '2026-10-16T11:00:00+08:00' };

describe('Booking schedule preview', () => {
  beforeEach(() => vi.clearAllMocks());
  it('loads the requested venue for the full requested day and displays existing reservations', async () => {
    getVenueAvailability.mockResolvedValue({ data: [{ id: 2, status: 'approved', start_time: booking.start_time, end_time: booking.end_time, reserved_by: 'Computing Council' }] });
    render(<BookingSchedulePreview booking={booking} />);
    expect(await screen.findByText('Reserved by Computing Council')).toBeInTheDocument();
    expect(getVenueAvailability).toHaveBeenCalledWith(3, { from: '2026-10-16T00:00:00+08:00', to: '2026-10-16T23:59:59+08:00' });
  });
  it('shows an error instead of claiming the venue is free and allows retry', async () => {
    getVenueAvailability.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] });
    render(<BookingSchedulePreview booking={booking} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the venue schedule.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No bookings on this date.')).toBeInTheDocument();
  });
});
