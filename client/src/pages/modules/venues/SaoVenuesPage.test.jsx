import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPageMeta } from '../../../lib/pageMeta';
import SaoVenuesPage from './SaoVenuesPage';

const venueMocks = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueBookings: vi.fn(),
  getVenueAvailability: vi.fn(),
  updateVenue: vi.fn(),
  reviewVenueBooking: vi.fn(),
}));

vi.mock('../../../services/venueService', () => ({
  ...venueMocks,
  createVenue: vi.fn(),
  deleteVenue: vi.fn(),
}));

const EMPTY = { data: { data: [], total: 0, current_page: 1, last_page: 1 } };

const booking = (id, status, start, end, orgName, extra = {}) => ({
  id, venue_id: 8, status, start_time: start, end_time: end, organization: { name: orgName, acronym: null }, event: null, venue: { name: 'Main Hall' }, ...extra,
});

function envelope(rows, page = 1, lastPage = 1, total = rows.length) {
  return { data: { data: rows, total, current_page: page, last_page: lastPage, per_page: 100 } };
}

function openTab(name) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('SaoVenuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    venueMocks.getVenues.mockResolvedValue({ data: [{ id: 8, name: 'Main Hall', location: 'Campus', capacity: 100, is_active: true }] });
    venueMocks.getVenueBookings.mockResolvedValue(EMPTY);
    venueMocks.getVenueAvailability.mockResolvedValue({ data: [] });
    venueMocks.updateVenue.mockResolvedValue({ data: { id: 8, is_active: false } });
  });

  it('says what the page is for in the SAO purpose line', () => {
    expect(getPageMeta('/dashboard/super-admin/venues', 'SUPER_ADMIN').purpose).toBe('See who has each venue and when, and decide booking requests with conflicts in view.');
  });

  it('changes venue status through the three-dot menu', async () => {
    render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: /Venue catalog/ }));
    fireEvent.click(await findRowAction('Mark inactive', 'Main Hall'));
    await waitFor(() => expect(venueMocks.updateVenue).toHaveBeenCalledWith(8, { is_active: false }));
  });

  describe('calendar', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T04:00:00Z'));
      venueMocks.getVenueBookings.mockImplementation((params) => Promise.resolve(envelope(
        params.status === 'approved'
          ? [booking(31, 'approved', '2026-10-07T01:00:00Z', '2026-10-07T03:00:00Z', 'Computer Society', { event: { title: 'Hackathon' } })]
          : [booking(32, 'pending', '2026-10-08T06:00:00Z', '2026-10-08T07:00:00Z', 'Arts Guild')],
      )));
    });

    afterEach(() => vi.useRealTimers());

    it('opens on the calendar with the booking requests tab second', async () => {
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      const tabs = await screen.findAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Calendar', 'Booking requests', 'Venue catalog']);
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(await screen.findByRole('heading', { name: 'Venue calendar' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Booking requests' })).not.toBeInTheDocument();
    });

    it('shows every organization with its event, venue and time for the visible week', async () => {
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      const wednesday = within(await screen.findByRole('group', { name: /Bookings on Wednesday, October 7/ }));
      expect(await wednesday.findByRole('button', { name: /Approved booking, Computer Society, Hackathon, Main Hall, 9:00 AM to 11:00 AM/ })).toBeInTheDocument();
      expect(within(screen.getByRole('group', { name: /Bookings on Thursday, October 8/ })).getByRole('button', { name: /Pending booking, Arts Guild, Main Hall/ })).toBeInTheDocument();
      expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-05T00:00:00+08:00', to: '2026-10-11T23:59:59+08:00', status: 'approved', page: 1, per_page: 100 }));
      expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', venue_id: undefined }));
    });

    it('names an organization by its acronym when it has one', async () => {
      venueMocks.getVenueBookings.mockImplementation((params) => Promise.resolve(envelope(
        params.status === 'approved' ? [booking(31, 'approved', '2026-10-07T01:00:00Z', '2026-10-07T03:00:00Z', 'Computer Society', { organization: { name: 'Computer Society', acronym: 'CS' } })] : [],
      )));
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      expect(await screen.findByRole('button', { name: /Approved booking, CS, Main Hall/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Approved booking, CS/ }));
      expect(within(screen.getByRole('dialog', { name: 'Booking details' })).getByText('Computer Society')).toBeInTheDocument();
    });

    it('fetches every page of the window so no booking is silently missing', async () => {
      venueMocks.getVenueBookings.mockImplementation((params) => {
        if (params.status === 'pending') return Promise.resolve(EMPTY);
        const rows = { 1: [booking(1, 'approved', '2026-10-07T01:00:00Z', '2026-10-07T02:00:00Z', 'First Page Club')], 2: [booking(2, 'approved', '2026-10-08T01:00:00Z', '2026-10-08T02:00:00Z', 'Second Page Club')], 3: [booking(3, 'approved', '2026-10-09T01:00:00Z', '2026-10-09T02:00:00Z', 'Third Page Club')] };
        return Promise.resolve(envelope(rows[params.page], params.page, 3, 3));
      });
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      expect(await screen.findByRole('button', { name: /First Page Club/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Second Page Club/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Third Page Club/ })).toBeInTheDocument();
      expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', page: 3 }));
      expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
    });

    it('reloads the visible window when the view, the date or the venue changes', async () => {
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      await screen.findByRole('button', { name: /Computer Society/ });

      fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-12T00:00:00+08:00', to: '2026-10-18T23:59:59+08:00' })));

      fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-09-28T00:00:00+08:00', to: '2026-11-01T23:59:59+08:00' })));

      fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-14T00:00:00+08:00', to: '2026-10-14T23:59:59+08:00' })));

      fireEvent.change(screen.getByRole('combobox', { name: 'Venue to show' }), { target: { value: '8' } });
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ venue_id: '8', from: '2026-10-14T00:00:00+08:00', to: '2026-10-14T23:59:59+08:00' })));
    });

    it('opens a day from the month view', async () => {
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      await screen.findByRole('button', { name: /Computer Society/ });
      fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
      fireEvent.click(await screen.findByRole('button', { name: /Open Thursday, October 8/ }));
      await waitFor(() => expect(venueMocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-08T00:00:00+08:00', to: '2026-10-08T23:59:59+08:00' })));
      expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
    });

    it('labels a pending request that overlaps another booking as a Conflict on the calendar', async () => {
      venueMocks.getVenueBookings.mockImplementation((params) => Promise.resolve(envelope(
        params.status === 'approved'
          ? [booking(31, 'approved', '2026-10-07T01:00:00Z', '2026-10-07T03:00:00Z', 'Computer Society')]
          : [booking(32, 'pending', '2026-10-07T02:00:00Z', '2026-10-07T04:00:00Z', 'Arts Guild'), booking(33, 'pending', '2026-10-07T04:00:00Z', '2026-10-07T05:00:00Z', 'Back To Back Club')],
      )));
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      const clash = await screen.findByRole('button', { name: /Pending booking, Conflict, Arts Guild/ });
      expect(within(clash).getByText('Conflict')).toBeInTheDocument();
      const backToBack = screen.getByRole('button', { name: /Pending booking, Back To Back Club/ });
      expect(backToBack).not.toHaveTextContent('Conflict');
      expect(screen.getByRole('button', { name: /Approved booking, Computer Society/ })).not.toHaveTextContent('Conflict');
    });

    it('sends the SAO from a calendar booking to the matching requests', async () => {
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      fireEvent.click(await screen.findByRole('button', { name: /Pending booking, Arts Guild/ }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Booking details' })).getByRole('button', { name: 'Show in booking requests' }));
      expect(screen.getByRole('tab', { name: /Booking requests/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('pending');
      expect(screen.getByRole('combobox', { name: 'Filter by venue' })).toHaveValue('8');
    });

    it('keeps the calendar venue and the queue venue filter in sync', async () => {
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      await screen.findByRole('button', { name: /Computer Society/ });

      fireEvent.change(screen.getByRole('combobox', { name: 'Venue to show' }), { target: { value: '8' } });
      openTab(/Booking requests/);
      expect(screen.getByRole('combobox', { name: 'Filter by venue' })).toHaveValue('8');

      fireEvent.change(screen.getByRole('combobox', { name: 'Filter by venue' }), { target: { value: '' } });
      openTab('Calendar');
      expect(screen.getByRole('combobox', { name: 'Venue to show' })).toHaveValue('');
    });

    it('shows a retryable error when the calendar cannot load', async () => {
      venueMocks.getVenueBookings.mockRejectedValue({ response: { data: { message: 'Calendar is down.' } } });
      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      expect((await screen.findAllByText('Calendar is down.')).length).toBeGreaterThan(0);
    });
  });

  describe('booking requests', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T04:00:00Z'));
    });

    afterEach(() => vi.useRealTimers());

    function serveQueue(queueRows, windowRows) {
      venueMocks.getVenueBookings.mockImplementation((params) => {
        if (params.from) return Promise.resolve(envelope(windowRows.filter((row) => row.status === params.status)));
        return Promise.resolve({ data: { data: queueRows, total: queueRows.length, current_page: 1, last_page: 1, per_page: 20 } });
      });
    }

    it('flags a clashing pending request with a Conflict label and leaves back to back requests alone', async () => {
      const clash = booking(32, 'pending', '2026-10-07T02:00:00Z', '2026-10-07T04:00:00Z', 'Arts Guild');
      const touching = booking(35, 'pending', '2026-10-07T04:00:00Z', '2026-10-07T05:00:00Z', 'Touching Club');
      const otherVenue = booking(33, 'pending', '2026-10-07T03:00:00Z', '2026-10-07T04:00:00Z', 'Other Venue Club', { venue_id: 9 });
      const approved = booking(31, 'approved', '2026-10-07T01:00:00Z', '2026-10-07T03:00:00Z', 'Computer Society');
      serveQueue([clash, touching, otherVenue], [clash, touching, otherVenue, approved]);

      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      openTab(/Booking requests/);
      const rows = await screen.findAllByRole('row');
      const rowOf = (name) => rows.find((row) => within(row).queryByText(name));

      await waitFor(() => expect(within(rowOf('Arts Guild')).getByText('Conflict')).toBeInTheDocument());
      expect(within(rowOf('Touching Club')).queryByText('Conflict')).not.toBeInTheDocument();
      expect(within(rowOf('Other Venue Club')).queryByText('Conflict')).not.toBeInTheDocument();
    });

    it('shows the SAO who and what overlaps before approving, and ignores a booking that only touches', async () => {
      const pending = booking(32, 'pending', '2026-10-07T02:00:00Z', '2026-10-07T04:00:00Z', 'Arts Guild');
      serveQueue([pending], [pending]);
      venueMocks.getVenueAvailability.mockResolvedValue({ data: [
        { id: 32, status: 'pending', start_time: pending.start_time, end_time: pending.end_time, reserved_by: 'Arts Guild' },
        { id: 40, status: 'approved', start_time: '2026-10-07T01:00:00Z', end_time: '2026-10-07T03:00:00Z', reserved_by: 'Computer Society' },
        { id: 41, status: 'pending', start_time: '2026-10-07T03:30:00Z', end_time: '2026-10-07T05:00:00Z', reserved_by: 'Nursing Council' },
        { id: 42, status: 'approved', start_time: '2026-10-07T04:00:00Z', end_time: '2026-10-07T05:00:00Z', reserved_by: 'Touching Club' },
      ] });

      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      openTab(/Booking requests/);
      fireEvent.click(await findRowAction('Approve'));

      const dialog = within(await screen.findByRole('dialog', { name: 'Approve this booking?' }));
      expect(await dialog.findByText('Overlaps 2 other bookings for this venue')).toBeInTheDocument();
      expect(dialog.getByText(/Approved: Computer Society/)).toBeInTheDocument();
      expect(dialog.getByText(/Pending: Nursing Council/)).toBeInTheDocument();
      expect(within(dialog.getByText('Overlaps 2 other bookings for this venue').parentElement).queryByText(/Touching Club/)).not.toBeInTheDocument();
      expect(venueMocks.getVenueAvailability).toHaveBeenCalledWith(8, { from: pending.start_time, to: pending.end_time });
    });

    it('warns instead of stating there is no overlap when the availability check fails', async () => {
      const pending = booking(32, 'pending', '2026-10-07T02:00:00Z', '2026-10-07T04:00:00Z', 'Arts Guild');
      serveQueue([pending], [pending]);
      venueMocks.getVenueAvailability.mockRejectedValue(new Error('offline'));

      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      openTab(/Booking requests/);
      fireEvent.click(await findRowAction('Approve'));

      const dialog = within(await screen.findByRole('dialog', { name: 'Approve this booking?' }));
      expect(await dialog.findByText('Could not check for overlapping bookings. Check the calendar before approving.')).toBeInTheDocument();
      expect(dialog.queryByText('No overlapping bookings for this venue and time.')).not.toBeInTheDocument();
    });

    it('says the queue conflict lookup failed instead of quietly dropping every Conflict label, and retries', async () => {
      const clash = booking(32, 'pending', '2026-10-07T02:00:00Z', '2026-10-07T04:00:00Z', 'Arts Guild');
      const approved = booking(31, 'approved', '2026-10-07T01:00:00Z', '2026-10-07T03:00:00Z', 'Computer Society');
      let windowDown = true;
      venueMocks.getVenueBookings.mockImplementation((params) => {
        if (params.from && windowDown) return Promise.reject(new Error('offline'));
        if (params.from) return Promise.resolve(envelope([clash, approved].filter((row) => row.status === params.status)));
        return Promise.resolve({ data: { data: [clash], total: 1, current_page: 1, last_page: 1, per_page: 20 } });
      });

      render(<MemoryRouter><SaoVenuesPage /></MemoryRouter>);
      openTab(/Booking requests/);

      expect(await screen.findByText(/Could not check these requests for conflicts/)).toBeInTheDocument();
      const rowOf = () => screen.getAllByRole('row').find((row) => within(row).queryByText('Arts Guild'));
      expect(within(rowOf()).queryByText('Conflict')).not.toBeInTheDocument();

      windowDown = false;
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(within(rowOf()).getByText('Conflict')).toBeInTheDocument());
      expect(screen.queryByText(/Could not check these requests for conflicts/)).not.toBeInTheDocument();
    });
  });
});
