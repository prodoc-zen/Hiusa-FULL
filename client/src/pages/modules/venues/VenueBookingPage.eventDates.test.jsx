import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    eventMocks.getEvents.mockResolvedValue({ data: [{ id: 5, title: 'Leadership Seminar', start_time: '2026-11-13T01:00:00Z', end_time: '2026-11-15T09:00:00Z' }] });
  });

  async function openForm() {
    render(<MemoryRouter><VenueBookingPage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Request a venue' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Request a venue booking' });
    await within(dialog).findByRole('option', { name: 'Leadership Seminar' });
    return dialog;
  }

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
});
