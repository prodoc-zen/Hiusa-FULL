import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventRegistrationPanel from './EventRegistrationPanel';
import { cancelEventRegistration, getEventRegistrations, getMyEventRegistrations, registerForEvent } from '../../services/eventService';

vi.mock('../../services/eventService', () => ({
  getMyEventRegistrations: vi.fn(),
  getEventRegistrations: vi.fn(),
  registerForEvent: vi.fn(),
  cancelEventRegistration: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const future = new Date(Date.now() + 3 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const event = (extra = {}) => ({ id: 7, title: 'Foundation Week', status: 'approved', start_time: future, ...extra });
const mine = (registration) => ({ data: { upcoming: registration ? [registration] : [], past: [] } });

describe('EventRegistrationPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a student register for an open event and shows the new state', async () => {
    vi.mocked(getMyEventRegistrations)
      .mockResolvedValueOnce(mine(null))
      .mockResolvedValueOnce(mine({ id: 1, event_id: 7, status: 'registered', registered_at: future }));
    vi.mocked(registerForEvent).mockResolvedValue({ data: {} });
    render(<EventRegistrationPanel event={event()} role="STUDENT" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Register for this event' }));

    expect(await screen.findByRole('button', { name: 'Cancel registration' })).toBeInTheDocument();
    expect(registerForEvent).toHaveBeenCalledWith(7);
    expect(screen.getByText('Registered')).toBeInTheDocument();
  });

  it('says "You are registered" and moves the stepper to check-in', async () => {
    vi.mocked(getMyEventRegistrations).mockResolvedValue(mine({ id: 1, event_id: 7, status: 'registered', registered_at: past }));
    render(<EventRegistrationPanel event={event()} role="STUDENT" />);

    expect(await screen.findByText('You are registered')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Your registration progress' });
    expect(within(steps).getByText('Register').closest('li')).toHaveTextContent('Done');
    expect(within(steps).getByText('Check in at the event').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('marks the stepper blocked when registration is closed and when a registered student never checked in', async () => {
    vi.mocked(getMyEventRegistrations).mockResolvedValue(mine(null));
    const { unmount } = render(<EventRegistrationPanel event={event({ start_time: past })} role="STUDENT" />);
    const closed = await screen.findByRole('list', { name: 'Your registration progress' });
    expect(within(closed).getByText('Register').closest('li')).toHaveTextContent('Blocked');
    expect(within(closed).getByText('Closed')).toBeInTheDocument();
    unmount();

    vi.mocked(getMyEventRegistrations).mockResolvedValue({ data: { upcoming: [], past: [{ id: 1, event_id: 7, status: 'no_show' }] } });
    render(<EventRegistrationPanel event={event({ start_time: past })} role="STUDENT" />);
    const missed = await screen.findByRole('list', { name: 'Your registration progress' });
    expect(within(missed).getByText('Check in at the event').closest('li')).toHaveTextContent('Blocked');
  });

  it('lets a registered student cancel before the event starts', async () => {
    vi.mocked(getMyEventRegistrations)
      .mockResolvedValueOnce(mine({ id: 1, event_id: 7, status: 'registered', registered_at: past }))
      .mockResolvedValueOnce({ data: { upcoming: [], past: [{ id: 1, event_id: 7, status: 'cancelled' }] } });
    vi.mocked(cancelEventRegistration).mockResolvedValue({ data: {} });
    render(<EventRegistrationPanel event={event()} role="STUDENT" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel registration' }));

    expect(await screen.findByText(/You cancelled earlier/)).toBeInTheDocument();
    expect(cancelEventRegistration).toHaveBeenCalledWith(7);
  });

  it('explains why registration is unavailable instead of offering a dead button', async () => {
    vi.mocked(getMyEventRegistrations).mockResolvedValue(mine(null));
    render(<EventRegistrationPanel event={event({ status: 'pending' })} role="STUDENT" />);

    expect(await screen.findByText('Registration opens once this event is approved.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('surfaces the server reason when registration is refused', async () => {
    vi.mocked(getMyEventRegistrations).mockResolvedValue(mine(null));
    vi.mocked(registerForEvent).mockRejectedValue({ response: { status: 422, data: { message: 'This event has reached its registration capacity.' } } });
    render(<EventRegistrationPanel event={event()} role="STUDENT" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Register for this event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This event has reached its registration capacity.');
  });

  it('shows organizers capacity, counts and the roster', async () => {
    vi.mocked(getEventRegistrations).mockResolvedValue({
      data: {
        summary: { capacity: 40, registered: 2, attended: 1, cancelled: 1, no_show: 0, remaining: 37 },
        registrations: [{ id: 3, user_id: '2023-0001', status: 'registered', registered_at: past, user: { first_name: 'Juan', last_name: 'Vera', program: 'BSIT', year_level: '3rd Year' } }],
        pagination: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
      },
    });
    render(<EventRegistrationPanel event={event()} role="SBO_OFFICER" />);

    expect(await screen.findByText('Juan Vera')).toBeInTheDocument();
    expect(screen.getByText('3 of 40 · 37 left')).toBeInTheDocument();
    expect(getEventRegistrations).toHaveBeenCalledWith(7, { page: 1, per_page: 10 });
    await waitFor(() => expect(getMyEventRegistrations).not.toHaveBeenCalled());
  });

  it('renders nothing for roles that neither register nor organize here', () => {
    const { container } = render(<EventRegistrationPanel event={event()} role="DEPARTMENT_HEAD" />);
    expect(container).toBeEmptyDOMElement();
  });
});
