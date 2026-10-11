import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VenueCalendar from './VenueCalendar';

const venues = [
  { id: 8, name: 'Main Hall', is_active: true },
  { id: 9, name: 'Gym', is_active: true },
  { id: 10, name: 'Old Annex', is_active: false },
];

const slot = (id, venueId, venueName, status, start, end, reservedBy, eventTitle = null) => ({
  id, venue_id: venueId, venue_name: venueName, status, start_time: start, end_time: end, reserved_by: reservedBy, organization_name: `${reservedBy} Full Name`, event_title: eventTitle,
});

const slots = [
  slot(1, 8, 'Main Hall', 'approved', '2026-10-07T01:00:00Z', '2026-10-07T03:00:00Z', 'CS', 'Hackathon'),
  slot(2, 9, 'Gym', 'pending', '2026-10-07T02:00:00Z', '2026-10-07T04:00:00Z', 'Arts Guild'),
  slot(3, 8, 'Main Hall', 'pending', '2026-10-08T06:00:00Z', '2026-10-08T07:30:00Z', 'Nursing Council', 'Orientation'),
];

function renderCalendar(props = {}) {
  const handlers = { onVenueChange: vi.fn(), onChange: vi.fn(), onRetry: vi.fn() };
  render(<VenueCalendar view="week" anchor="2026-10-07" loaded={{ view: 'week', anchor: '2026-10-07' }} slots={slots} venues={venues} venueId="" conflictIds={new Set()} loading={false} error={null} {...handlers} {...props} />);
  return handlers;
}

describe('VenueCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('offers Day, Week and Month views and reports a change with the current day kept', () => {
    const { onChange } = renderCalendar();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'month', anchor: '2026-10-07' });
    fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'day', anchor: '2026-10-07' });
  });

  it('steps by the unit of the view, returns to Today and jumps to a chosen date', () => {
    const { onChange } = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'week', anchor: '2026-10-14' });
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'week', anchor: '2026-09-30' });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'week', anchor: '2026-10-14' });
    fireEvent.change(screen.getByLabelText('Jump to date'), { target: { value: '2026-12-25' } });
    expect(onChange).toHaveBeenLastCalledWith({ view: 'week', anchor: '2026-12-25' });
  });

  it('labels the previous and next controls and the range for each view', () => {
    const { rerender } = render(<VenueCalendar view="day" anchor="2026-10-07" loaded={null} slots={[]} venues={venues} venueId="" conflictIds={new Set()} loading={false} error={null} onVenueChange={vi.fn()} onChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next day' })).toBeInTheDocument();
    expect(screen.getByText('Wednesday, October 7, 2026')).toBeInTheDocument();
    rerender(<VenueCalendar view="month" anchor="2026-10-07" loaded={null} slots={[]} venues={venues} venueId="" conflictIds={new Set()} loading={false} error={null} onVenueChange={vi.fn()} onChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByText('October 2026')).toBeInTheDocument();
  });

  it('lists a colour legend entry per venue in the week view, only while every venue is shown', () => {
    renderCalendar();
    const legend = within(screen.getByRole('list', { name: 'Venue colours' }));
    expect(legend.getByText('Main Hall')).toBeInTheDocument();
    expect(legend.getByText('Gym')).toBeInTheDocument();
    expect(legend.queryByText('Old Annex')).not.toBeInTheDocument();
  });

  it('drops the venue legend once one venue is chosen', () => {
    renderCalendar({ venueId: '8' });
    expect(screen.queryByRole('list', { name: 'Venue colours' })).not.toBeInTheDocument();
  });

  it('reports the chosen venue', () => {
    const { onVenueChange } = renderCalendar();
    fireEvent.change(screen.getByRole('combobox', { name: 'Venue to show' }), { target: { value: '9' } });
    expect(onVenueChange).toHaveBeenCalledWith('9');
  });

  it('opens a booking with the full organization name, event, venue and time range', () => {
    const onShowInQueue = vi.fn();
    renderCalendar({ onShowInQueue });
    fireEvent.click(screen.getByRole('button', { name: /Approved booking, CS, Hackathon, Main Hall/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Booking details' }));
    expect(dialog.getByText('CS Full Name')).toBeInTheDocument();
    expect(dialog.getByText('Hackathon')).toBeInTheDocument();
    expect(dialog.getByText('Main Hall')).toBeInTheDocument();
    expect(dialog.getByText('9:00 AM to 11:00 AM')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Show in booking requests' }));
    expect(onShowInQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('shows the Conflict label in the booking details for a clashing request', () => {
    renderCalendar({ conflictIds: new Set([2]) });
    fireEvent.click(screen.getByRole('button', { name: /Pending booking, Conflict, Arts Guild/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Booking details' }));
    expect(dialog.getByText('Conflict')).toBeInTheDocument();
    expect(dialog.getByText(/overlaps another booking for the same venue/)).toBeInTheDocument();
  });

  it('keeps the loaded grid on screen while the next window loads, then says when a window is empty', () => {
    const { rerender } = render(<VenueCalendar view="week" anchor="2026-10-14" loaded={{ view: 'week', anchor: '2026-10-07' }} slots={slots} venues={venues} venueId="" conflictIds={new Set()} loading error={null} onVenueChange={vi.fn()} onChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByRole('status', { name: 'Loading venue calendar' })).not.toBeInTheDocument();
    expect(screen.getByText('Updating...')).toBeInTheDocument();
    expect(screen.getByText('Oct 12 - Oct 18, 2026')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Bookings on Wednesday, October 7/ })).getAllByRole('button')).toHaveLength(2);
    rerender(<VenueCalendar view="week" anchor="2026-10-14" loaded={{ view: 'week', anchor: '2026-10-14' }} slots={[]} venues={venues} venueId="" conflictIds={new Set()} loading={false} error={null} onVenueChange={vi.fn()} onChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByText('Updating...')).not.toBeInTheDocument();
    expect(screen.getByText('No pending or approved bookings this week.')).toBeInTheDocument();
  });

  it('shows a loading state and a retryable error', () => {
    const { rerender } = render(<VenueCalendar view="week" anchor="2026-10-07" loaded={null} slots={[]} venues={venues} venueId="" conflictIds={new Set()} loading error={null} onVenueChange={vi.fn()} onChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Loading venue calendar' })).toBeInTheDocument();
    const onRetry = vi.fn();
    rerender(<VenueCalendar view="week" anchor="2026-10-07" loaded={null} slots={[]} venues={venues} venueId="" conflictIds={new Set()} loading={false} error="Could not load the venue calendar." onVenueChange={vi.fn()} onChange={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says when the page ceiling truncated the window', () => {
    renderCalendar({ truncated: { shown: 5000, total: 7000 } });
    expect(screen.getByText(/Showing the first 5000 bookings of 7000/)).toBeInTheDocument();
  });

  describe('day view', () => {
    function renderDay(props = {}) {
      return renderCalendar({ view: 'day', loaded: { view: 'day', anchor: '2026-10-07' }, ...props });
    }

    it('gives each active venue its own lane and leaves out an inactive venue with no booking', () => {
      renderDay();
      const grid = within(screen.getByTestId('day-grid'));
      expect(grid.getByRole('group', { name: /Main Hall bookings on Wednesday, October 7/ })).toBeInTheDocument();
      expect(grid.getByRole('group', { name: /Gym bookings on Wednesday, October 7/ })).toBeInTheDocument();
      expect(grid.queryByRole('group', { name: /Old Annex/ })).not.toBeInTheDocument();
      expect(within(grid.getByRole('group', { name: /Main Hall bookings/ })).getByRole('button', { name: /Approved booking, CS, Hackathon, Main Hall, 9:00 AM to 11:00 AM/ })).toBeInTheDocument();
      expect(within(grid.getByRole('group', { name: /Gym bookings/ })).getByRole('button', { name: /Pending booking, Arts Guild/ })).toBeInTheDocument();
    });

    it('stacks the venues as lists for small screens with organization, event and time range', () => {
      renderDay({ conflictIds: new Set([2]) });
      const stack = within(screen.getByTestId('day-stack'));
      expect(stack.getByRole('heading', { name: 'Main Hall' })).toBeInTheDocument();
      expect(stack.getByText('CS')).toBeInTheDocument();
      expect(stack.getByText('Hackathon')).toBeInTheDocument();
      expect(stack.getByText('9:00 AM - 11:00 AM')).toBeInTheDocument();
      expect(stack.getByText('Conflict')).toBeInTheDocument();
      expect(stack.queryAllByText('Nothing booked.')).toHaveLength(0);
    });

    it('lists only the chosen venue', () => {
      renderDay({ venueId: '9' });
      const stack = within(screen.getByTestId('day-stack'));
      expect(stack.queryByRole('heading', { name: 'Main Hall' })).not.toBeInTheDocument();
      expect(stack.getByRole('heading', { name: 'Gym' })).toBeInTheDocument();
    });

    it('keeps the stacked list free of sideways scrolling and the lane grid inside its own box', () => {
      renderDay();
      expect(screen.getByTestId('day-stack')).toHaveClass('md:hidden');
      expect(screen.getByTestId('day-grid')).toHaveClass('hidden', 'md:block', 'overflow-x-auto', 'max-w-full');
    });
  });

  describe('month view', () => {
    const busyDay = Array.from({ length: 5 }, (_, index) => slot(100 + index, 8, 'Main Hall', 'approved', `2026-10-15T0${index}:00:00Z`, `2026-10-15T0${index}:45:00Z`, `Club ${index}`));

    function renderMonth(props = {}) {
      return renderCalendar({ view: 'month', loaded: { view: 'month', anchor: '2026-10-07' }, slots: [...slots, ...busyDay], ...props });
    }

    it('shows booking chips with organization and time inside the day they belong to', () => {
      renderMonth();
      const wednesday = within(screen.getByRole('group', { name: /Bookings on Wednesday, October 7/ }));
      expect(wednesday.getByRole('button', { name: /Approved booking, CS, Hackathon, Main Hall/ })).toHaveTextContent('9-11 AM CS');
      expect(wednesday.getByRole('button', { name: /Pending booking, Arts Guild/ })).toBeInTheDocument();
    });

    it('caps a busy day at three chips and opens that day from +N more', () => {
      const { onChange } = renderMonth();
      const busy = within(screen.getByRole('group', { name: /Bookings on Thursday, October 15/ }));
      expect(busy.getAllByRole('button', { name: /Approved booking/ })).toHaveLength(3);
      fireEvent.click(busy.getByRole('button', { name: '+2 more' }));
      expect(onChange).toHaveBeenLastCalledWith({ view: 'day', anchor: '2026-10-15' });
    });

    it('opens a day from its date number and marks a conflict with the word as well as colour', () => {
      const { onChange } = renderMonth({ conflictIds: new Set([2]) });
      fireEvent.click(screen.getByRole('button', { name: /Open Thursday, October 8/ }));
      expect(onChange).toHaveBeenLastCalledWith({ view: 'day', anchor: '2026-10-08' });
      expect(screen.getByRole('button', { name: /Pending booking, Conflict, Arts Guild/ })).toHaveTextContent('Conflict');
    });

    it('scrolls inside its own labelled region', () => {
      renderMonth();
      expect(screen.getByRole('region', { name: /Month of bookings/ })).toHaveClass('overflow-x-auto', 'max-w-full');
    });
  });
});
