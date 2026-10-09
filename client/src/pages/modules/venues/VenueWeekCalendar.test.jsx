import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VenueWeekCalendar, { addDays, weekStartOf } from './VenueWeekCalendar';

const venues = [{ id: 8, name: 'Main Hall' }, { id: 9, name: 'Gym' }];

const slots = [
  { id: 1, start_time: '2026-10-05T01:00:00Z', end_time: '2026-10-05T03:00:00Z', status: 'approved', reserved_by: 'Computer Society', event_title: 'Hackathon', venue_name: 'Main Hall' },
  { id: 2, start_time: '2026-10-05T02:00:00Z', end_time: '2026-10-05T04:00:00Z', status: 'pending', reserved_by: 'Arts Guild', event_title: null, venue_name: 'Gym' },
  { id: 3, start_time: '2026-10-07T06:00:00Z', end_time: '2026-10-07T07:30:00Z', status: 'pending', reserved_by: 'Nursing Council', event_title: 'Orientation', venue_name: 'Main Hall' },
];

function renderCalendar(props = {}) {
  const handlers = { onVenueChange: vi.fn(), onWeekChange: vi.fn(), onRetry: vi.fn() };
  render(<VenueWeekCalendar weekStart="2026-10-05" slots={slots} venues={venues} venueId="" loading={false} error={null} {...handlers} {...props} />);
  return handlers;
}

describe('VenueWeekCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('anchors weeks on Monday in Manila time', () => {
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02');
  });

  it('places each booking in its day column with organization, event, venue, status and time', () => {
    renderCalendar();
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    expect(monday.getAllByRole('img')).toHaveLength(2);
    expect(monday.getByRole('img', { name: /Approved booking, Computer Society, Hackathon, Main Hall, 9:00 AM to 11:00 AM/ })).toBeInTheDocument();
    expect(monday.getByRole('img', { name: /Pending booking, Arts Guild, Gym, 10:00 AM to 12:00 PM/ })).toBeInTheDocument();

    const wednesday = within(screen.getByRole('group', { name: /Bookings on Wednesday, October 7/ }));
    expect(wednesday.getAllByRole('img')).toHaveLength(1);
    expect(wednesday.getByText('Nursing Council')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Bookings on Tuesday, October 6/ })).queryAllByRole('img')).toHaveLength(0);
  });

  it('lists the same bookings day by day for small screens', () => {
    renderCalendar();
    const agenda = within(screen.getByTestId('week-agenda'));
    expect(agenda.getByText('Computer Society')).toBeInTheDocument();
    expect(agenda.getByText('Hackathon')).toBeInTheDocument();
    expect(agenda.getAllByText('Pending')).toHaveLength(2);
    expect(agenda.getByText('Approved')).toBeInTheDocument();
    expect(agenda.getAllByText('Nothing booked.')).toHaveLength(5);
  });

  it('hides the venue name once a single venue is chosen', () => {
    renderCalendar({ venueId: '8', slots: [slots[0]] });
    expect(within(screen.getByTestId('week-agenda')).queryByText('Main Hall')).not.toBeInTheDocument();
  });

  it('navigates weeks and returns to the current week', () => {
    const { onWeekChange } = renderCalendar();
    expect(screen.getByText('Oct 5 - Oct 11, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onWeekChange).toHaveBeenLastCalledWith('2026-10-12');
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onWeekChange).toHaveBeenLastCalledWith('2026-09-28');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onWeekChange).toHaveBeenLastCalledWith('2026-10-12');
  });

  it('reports the chosen venue', () => {
    const { onVenueChange } = renderCalendar();
    fireEvent.change(screen.getByRole('combobox', { name: 'Venue to show' }), { target: { value: '9' } });
    expect(onVenueChange).toHaveBeenCalledWith('9');
  });

  it('shows an empty week, a loading state and a retryable error', () => {
    const { rerender } = render(<VenueWeekCalendar weekStart="2026-10-05" slots={[]} venues={venues} venueId="" loading={false} error={null} onVenueChange={vi.fn()} onWeekChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('No pending or approved bookings this week.')).toBeInTheDocument();

    rerender(<VenueWeekCalendar weekStart="2026-10-05" slots={[]} venues={venues} venueId="" loading error={null} onVenueChange={vi.fn()} onWeekChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Loading venue calendar' })).toBeInTheDocument();

    const onRetry = vi.fn();
    rerender(<VenueWeekCalendar weekStart="2026-10-05" slots={[]} venues={venues} venueId="" loading={false} error="Could not load the venue calendar." onVenueChange={vi.fn()} onWeekChange={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('Could not load the venue calendar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
