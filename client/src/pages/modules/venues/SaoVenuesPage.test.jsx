import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SaoVenuesPage from './SaoVenuesPage';

const venueMocks = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueBookings: vi.fn(),
  updateVenue: vi.fn(),
}));

vi.mock('../../../services/venueService', () => ({
  ...venueMocks,
  createVenue: vi.fn(),
  deleteVenue: vi.fn(),
  getVenueAvailability: vi.fn(),
  reviewVenueBooking: vi.fn(),
}));

describe('SaoVenuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    venueMocks.getVenues.mockResolvedValue({ data: [{ id: 8, name: 'Main Hall', location: 'Campus', capacity: 100, is_active: true }] });
    venueMocks.getVenueBookings.mockResolvedValue({ data: { data: [], total: 0, current_page: 1, last_page: 1 } });
    venueMocks.updateVenue.mockResolvedValue({ data: { id: 8, is_active: false } });
  });

  it('changes venue status through the status switch', async () => {
    render(<SaoVenuesPage />);
    const [switchControl] = await screen.findAllByRole('switch', { name: 'Main Hall active status' });
    expect(switchControl).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: 'Mark inactive' })).not.toBeInTheDocument();

    fireEvent.click(switchControl);
    await waitFor(() => expect(venueMocks.updateVenue).toHaveBeenCalledWith(8, { is_active: false }));
  });

  describe('availability calendar', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T04:00:00Z'));
      venueMocks.getVenueBookings.mockImplementation((params) => Promise.resolve({
        data: {
          data: params.status === 'approved'
            ? [{ id: 31, venue_id: 8, status: 'approved', start_time: '2026-10-07T01:00:00Z', end_time: '2026-10-07T03:00:00Z', organization: { name: 'Computer Society' }, event: { title: 'Hackathon' }, venue: { name: 'Main Hall' } }]
            : [{ id: 32, venue_id: 8, status: 'pending', start_time: '2026-10-08T06:00:00Z', end_time: '2026-10-08T07:00:00Z', organization: { name: 'Arts Guild' }, event: null, venue: { name: 'Main Hall' } }],
          total: 1, current_page: 1, last_page: 1,
        },
      }));
    });

    afterEach(() => vi.useRealTimers());

    it('shows who holds each venue this week below the booking queue', async () => {
      render(<SaoVenuesPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Booking requests/ }));

      const agenda = within(await screen.findByTestId('week-agenda'));
      expect(await agenda.findByText('Computer Society')).toBeInTheDocument();
      expect(agenda.getByText('Hackathon')).toBeInTheDocument();
      expect(agenda.getByText('Arts Guild')).toBeInTheDocument();
      expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-05T00:00:00+08:00', to: '2026-10-11T23:59:59+08:00', status: 'approved', per_page: 100 }));
      expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', venue_id: undefined }));
    });

    it('puts the decision queue before the availability calendar', async () => {
      render(<SaoVenuesPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Booking requests/ }));
      const queue = await screen.findByRole('heading', { name: 'Booking requests' });
      const calendar = await screen.findByRole('heading', { name: 'Availability calendar' });
      expect(queue.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps the calendar venue and the queue venue filter in sync', async () => {
      render(<SaoVenuesPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Booking requests/ }));
      await within(await screen.findByTestId('week-agenda')).findByText('Hackathon');

      fireEvent.change(screen.getByRole('combobox', { name: 'Venue to show' }), { target: { value: '8' } });
      expect(screen.getByRole('combobox', { name: 'Filter by venue' })).toHaveValue('8');

      fireEvent.change(screen.getByRole('combobox', { name: 'Filter by venue' }), { target: { value: '' } });
      expect(screen.getByRole('combobox', { name: 'Venue to show' })).toHaveValue('');
    });

    it('notes when the calendar fetch hit the 100 per status cap', async () => {
      venueMocks.getVenueBookings.mockImplementation((params) => Promise.resolve({
        data: { data: [{ id: params.status === 'pending' ? 1 : 2, venue_id: 8, status: params.status, start_time: '2026-10-07T01:00:00Z', end_time: '2026-10-07T02:00:00Z', organization: { name: 'Arts Guild' }, venue: { name: 'Main Hall' } }], total: params.from ? 130 : 1, current_page: 1, last_page: 1 },
      }));
      render(<SaoVenuesPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Booking requests/ }));
      expect(await screen.findByText(/Showing the first 2 bookings of 260/)).toBeInTheDocument();
    });

    it('reloads for the next week and for a single venue', async () => {
      render(<SaoVenuesPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Booking requests/ }));
      await within(await screen.findByTestId('week-agenda')).findByText('Hackathon');

      fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-12T00:00:00+08:00', to: '2026-10-18T23:59:59+08:00' })));

      fireEvent.change(screen.getByRole('combobox', { name: 'Venue to show' }), { target: { value: '8' } });
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ venue_id: '8', from: '2026-10-12T00:00:00+08:00' })));
    });

    it('shows a retryable error when the calendar cannot load', async () => {
      venueMocks.getVenueBookings.mockRejectedValue({ response: { data: { message: 'Calendar is down.' } } });
      render(<SaoVenuesPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Booking requests/ }));
      expect((await screen.findAllByText('Calendar is down.')).length).toBeGreaterThan(0);
    });
  });
});
