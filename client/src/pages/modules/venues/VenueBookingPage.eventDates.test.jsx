import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isoToLocalDateTimeInput } from '../../../utils/dateTime';
import VenueBookingPage from './VenueBookingPage';

const venueMocks = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueBookings: vi.fn(),
  getVenueAvailability: vi.fn(),
}));
const eventMocks = vi.hoisted(() => ({ getEvents: vi.fn() }));

vi.mock('../../../services/venueService', () => ({
  ...venueMocks,
  createVenueBooking: vi.fn(),
  withdrawVenueBooking: vi.fn(),
}));
vi.mock('../../../services/eventService', () => eventMocks);

describe('VenueBookingPage linked event dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    venueMocks.getVenues.mockResolvedValue({ data: [{ id: 8, name: 'Main Hall', location: 'Campus', capacity: 100, is_active: true }] });
    venueMocks.getVenueBookings.mockResolvedValue({ data: { data: [], total: 0, current_page: 1, last_page: 1 } });
    venueMocks.getVenueAvailability.mockResolvedValue({ data: [] });
    eventMocks.getEvents.mockResolvedValue({ data: [
      { id: 5, title: 'Leadership Seminar', start_time: '2026-11-13T01:00:00Z', end_time: '2026-11-15T09:00:00Z' },
      { id: 6, title: 'Founders Day', start_time: '2026-12-05T01:00:00Z', end_time: '2026-12-05T09:00:00Z', planning_details: { venue_type: 'on_campus', venue_id: 8 } },
      { id: 7, title: 'Community Visit', start_time: '2026-12-06T01:00:00Z', end_time: '2026-12-06T09:00:00Z', location: 'Barangay Hall', planning_details: { venue_type: 'off_campus' } },
    ] });
  });

  async function openForm() {
    render(<MemoryRouter><VenueBookingPage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Request a venue' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Request a venue booking' });
    await within(dialog).findByRole('option', { name: 'Leadership Seminar' });
    return dialog;
  }

  const pick = (dialog, id) => fireEvent.change(within(dialog).getByLabelText(/^Link to an event/), { target: { value: id } });

  it('warns when the booking day is outside the days of the linked event, and says nothing inside them', async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/^Start/), { target: { value: '2026-12-05T09:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^End/), { target: { value: '2026-12-05T11:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^Link to an event/), { target: { value: '5' } });

    expect(within(dialog).getByText(/This day is outside the dates of Leadership Seminar/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/^Start/), { target: { value: '2026-11-14T09:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^End/), { target: { value: '2026-11-14T11:00' } });
    expect(within(dialog).queryByText(/outside the dates of/)).not.toBeInTheDocument();
  });

  it('fills in the venue and times of an event picked by hand while those are still empty', async () => {
    const dialog = await openForm();
    pick(dialog, '6');

    expect(within(dialog).getByLabelText(/^Venue$/)).toHaveValue('8');
    expect(within(dialog).getByLabelText(/^Start/)).toHaveValue(isoToLocalDateTimeInput('2026-12-05T01:00:00Z'));
    expect(within(dialog).getByLabelText(/^End/)).toHaveValue(isoToLocalDateTimeInput('2026-12-05T09:00:00Z'));
  });

  it('fills in an off-campus event with its location', async () => {
    const dialog = await openForm();
    pick(dialog, '7');

    expect(within(dialog).getByLabelText(/^Venue type/)).toHaveValue('off_campus');
    expect(within(dialog).getByLabelText(/^Off-campus location/)).toHaveValue('Barangay Hall');
  });

  it('keeps the venue and times the admin already entered when an event is picked', async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/^Venue$/), { target: { value: '8' } });
    fireEvent.change(within(dialog).getByLabelText(/^Start/), { target: { value: '2026-12-05T13:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^End/), { target: { value: '2026-12-05T15:00' } });
    pick(dialog, '7');

    expect(within(dialog).getByLabelText(/^Venue type/)).toHaveValue('on_campus');
    expect(within(dialog).getByLabelText(/^Start/)).toHaveValue('2026-12-05T13:00');
    expect(within(dialog).getByLabelText(/^End/)).toHaveValue('2026-12-05T15:00');
  });
});
