import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VenueBookingPage from './VenueBookingPage';
import SaoVenuesPage from './SaoVenuesPage';
import { venueStageText } from './venueStage';

const mocks = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueBookings: vi.fn(),
  getVenueAvailability: vi.fn(),
  createVenueBooking: vi.fn(),
  withdrawVenueBooking: vi.fn(),
  reviewVenueBooking: vi.fn(),
  getEvents: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../../../services/venueService', () => ({
  getVenues: mocks.getVenues,
  getVenueBookings: mocks.getVenueBookings,
  getVenueAvailability: mocks.getVenueAvailability,
  createVenueBooking: mocks.createVenueBooking,
  withdrawVenueBooking: mocks.withdrawVenueBooking,
  reviewVenueBooking: mocks.reviewVenueBooking,
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  deleteVenue: vi.fn(),
}));
vi.mock('../../../services/eventService', () => ({ getEvents: mocks.getEvents }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: mocks.notifyError } }));

const VENUE = { id: 8, name: 'Main Hall', location: 'Campus', capacity: 100, is_active: true };
const EVENT = { id: 5, title: 'Orientation Day', start_time: '2026-10-20T01:00:00Z', end_time: '2026-10-20T08:00:00Z' };
const BOOKING = {
  id: 31,
  venue_id: 8,
  status: 'pending',
  remarks: null,
  start_time: '2026-10-20T01:00:00Z',
  end_time: '2026-10-20T08:00:00Z',
  venue: { name: 'Main Hall' },
  event: { title: 'Orientation Day' },
  organization: { name: 'Computing Society' },
};

function page(data) {
  return { data: { data, total: data.length, current_page: 1, last_page: 1, per_page: 20 } };
}

function renderAt(entry, element) {
  return render(<MemoryRouter initialEntries={[entry]}>{element}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVenues.mockResolvedValue({ data: [VENUE] });
  mocks.getVenueBookings.mockResolvedValue(page([BOOKING]));
  mocks.getVenueAvailability.mockResolvedValue({ data: [] });
  mocks.getEvents.mockResolvedValue({ data: [EVENT] });
});

describe('venue booking stage text', () => {
  it('reads the same for each status', () => {
    expect(venueStageText({ status: 'pending' })).toBe('Waiting for SAO approval');
    expect(venueStageText({ status: 'approved' })).toBe('Approved: venue booked');
    expect(venueStageText({ status: 'rejected' })).toBe('Rejected: read the remarks and request again');
    expect(venueStageText({ status: 'withdrawn' })).toBe('Withdrawn');
  });
});

describe('VenueBookingPage', () => {
  beforeEach(() => localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' })));

  it('opens the request form with the event from ?event= already chosen', async () => {
    renderAt('/dashboard/venues?event=5', <VenueBookingPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Request a venue booking' });
    expect(within(dialog).getByRole('combobox', { name: /Link to an event/ })).toHaveValue('5');
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('sends the chosen event with the booking request', async () => {
    mocks.createVenueBooking.mockResolvedValue({ data: { ...BOOKING, id: 40 } });
    renderAt('/dashboard/venues?event=5', <VenueBookingPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Request a venue booking' });
    fireEvent.change(within(dialog).getByLabelText(/^Start/), { target: { value: '2026-10-20T09:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^End/), { target: { value: '2026-10-20T17:00' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Venue$/ }), { target: { value: '8' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(mocks.createVenueBooking).toHaveBeenCalledWith(expect.objectContaining({ event_id: '5', venue_id: 8 })));
  });

  it('says so when ?event= names an event the organization does not have', async () => {
    renderAt('/dashboard/venues?event=99', <VenueBookingPage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That event is not available for a venue booking.'));
    expect(screen.queryByRole('dialog', { name: 'Request a venue booking' })).not.toBeInTheDocument();
  });

  it('shows the stage on each request row', async () => {
    renderAt('/dashboard/venues', <VenueBookingPage />);
    expect((await screen.findAllByText('Waiting for SAO approval')).length).toBeGreaterThan(0);
  });

  it.each([
    ['pending', 'Waiting for SAO approval', 'Owner: SAO'],
    ['approved', 'Approved: venue booked', null],
  ])('opens a %s request from ?record= with its stepper and the next step', async (status, title, owner) => {
    mocks.getVenueBookings.mockResolvedValue(page([{ ...BOOKING, status }]));
    renderAt('/dashboard/venues?record=31', <VenueBookingPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Main Hall' });
    expect(within(drawer).getByRole('list', { name: 'Venue booking progress' })).toBeInTheDocument();
    expect(within(drawer).getAllByText(title).length).toBeGreaterThan(0);
    if (owner) expect(within(drawer).getByText(owner)).toBeInTheDocument();
  });

  it('offers Book again on a rejected request and shows the SAO remarks', async () => {
    mocks.getVenueBookings.mockResolvedValue(page([{ ...BOOKING, status: 'rejected', remarks: 'Hall is closed that day.' }]));
    renderAt('/dashboard/venues?record=31', <VenueBookingPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Main Hall' });
    expect(within(drawer).getAllByText('Hall is closed that day.').length).toBeGreaterThan(0);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Book again' }));
    expect(await screen.findByRole('dialog', { name: 'Request a venue booking' })).toBeInTheDocument();
  });

  it('walks to a later page to find the request named by ?record=', async () => {
    mocks.getVenueBookings.mockImplementation(({ page: requested }) => Promise.resolve(requested === 2
      ? { data: { data: [BOOKING], total: 21, current_page: 2, last_page: 2, per_page: 20 } }
      : { data: { data: [{ ...BOOKING, id: 1 }], total: 21, current_page: 1, last_page: 2, per_page: 20 } }));
    renderAt('/dashboard/venues?record=31', <VenueBookingPage />);
    expect(await screen.findByRole('dialog', { name: 'Main Hall' })).toBeInTheDocument();
  });

  it('says so when ?record= names a request that is not in the list', async () => {
    renderAt('/dashboard/venues?record=500', <VenueBookingPage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That booking request is not in your organization\'s list.'));
  });

  it('gives a first-run state with one Request a venue button', async () => {
    mocks.getVenueBookings.mockResolvedValue(page([]));
    renderAt('/dashboard/venues', <VenueBookingPage />);
    expect(await screen.findByText('No booking requests yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Request a venue' })).toHaveLength(1);
  });

  it('keeps one primary Request a venue button in the header once requests exist', async () => {
    renderAt('/dashboard/venues', <VenueBookingPage />);
    await screen.findAllByText('Waiting for SAO approval');
    expect(screen.getAllByRole('button', { name: 'Request a venue' })).toHaveLength(1);
  });

  it('renders exactly one h1', async () => {
    renderAt('/dashboard/venues', <VenueBookingPage />);
    await screen.findAllByText('Waiting for SAO approval');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('is restricted for other roles, still under one h1', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    renderAt('/dashboard/venues', <VenueBookingPage />);
    expect(screen.getByText('Organization access only')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('SaoVenuesPage', () => {
  beforeEach(() => localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' })));

  it('opens the booking requests tab and the drawer from ?record=, even for a request already decided', async () => {
    mocks.getVenueBookings.mockResolvedValue(page([{ ...BOOKING, status: 'approved' }]));
    renderAt('/dashboard/super-admin/venues?record=31', <SaoVenuesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Main Hall' });
    expect(within(drawer).getAllByText('Approved: venue booked').length).toBeGreaterThan(0);
    expect(mocks.getVenueBookings).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    expect(screen.getByRole('tab', { name: /Booking requests/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the SAO a review callout and the Approve and Reject buttons on a pending request', async () => {
    renderAt('/dashboard/super-admin/venues?record=31', <SaoVenuesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Main Hall' });
    expect(within(drawer).getByText('Review the booking')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('dialog', { name: 'Reject this booking' })).toBeInTheDocument();
  });

  it('keeps the drawer open on the decided request after approving', async () => {
    mocks.reviewVenueBooking.mockResolvedValue({ data: { ...BOOKING, status: 'approved' } });
    renderAt('/dashboard/super-admin/venues?record=31', <SaoVenuesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Main Hall' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this booking?' });
    mocks.getVenueBookings.mockResolvedValue(page([]));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.reviewVenueBooking).toHaveBeenCalledWith(31, { status: 'approved' }));
    expect(await screen.findByRole('dialog', { name: 'Main Hall' })).toBeInTheDocument();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('puts New venue in the header and names who sends requests on the empty queue', async () => {
    mocks.getVenueBookings.mockResolvedValue(page([]));
    renderAt('/dashboard/super-admin/venues', <SaoVenuesPage />);
    expect(await screen.findByRole('button', { name: 'New venue' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New venue' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('tab', { name: /Booking requests/ }));
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
    expect(screen.getByText(/request venues from Venue booking/)).toBeInTheDocument();
  });

  it('renders exactly one h1', async () => {
    renderAt('/dashboard/super-admin/venues', <SaoVenuesPage />);
    await screen.findByRole('button', { name: 'New venue' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
