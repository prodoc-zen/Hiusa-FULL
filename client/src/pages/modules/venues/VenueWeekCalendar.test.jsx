import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewDays } from './calendarDates';
import VenueWeekCalendar from './VenueWeekCalendar';

const days = viewDays('week', '2026-10-05');

const slots = [
  { id: 1, venue_id: 8, start_time: '2026-10-05T01:00:00Z', end_time: '2026-10-05T03:00:00Z', status: 'approved', reserved_by: 'CS', event_title: 'Hackathon', venue_name: 'Main Hall' },
  { id: 2, venue_id: 9, start_time: '2026-10-05T02:00:00Z', end_time: '2026-10-05T04:00:00Z', status: 'pending', reserved_by: 'Arts Guild', event_title: null, venue_name: 'Gym' },
  { id: 3, venue_id: 8, start_time: '2026-10-07T06:00:00Z', end_time: '2026-10-07T07:30:00Z', status: 'pending', reserved_by: 'Nursing Council', event_title: 'Orientation', venue_name: 'Main Hall' },
];

function renderWeek(props = {}) {
  const onSelect = vi.fn();
  render(<VenueWeekCalendar days={days} slots={slots} conflictIds={new Set()} showVenue onSelect={onSelect} {...props} />);
  return { onSelect };
}

describe('VenueWeekCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('places each booking in its day column as a focusable button with organization, event, venue, status and time', () => {
    renderWeek();
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    expect(monday.getAllByRole('button')).toHaveLength(2);
    expect(monday.getByRole('button', { name: /Approved booking, CS, Hackathon, Main Hall, 9:00 AM to 11:00 AM/ })).toBeInTheDocument();
    expect(monday.getByRole('button', { name: /Pending booking, Arts Guild, Gym, 10:00 AM to 12:00 PM/ })).toBeInTheDocument();

    const wednesday = within(screen.getByRole('group', { name: /Bookings on Wednesday, October 7/ }));
    expect(wednesday.getAllByRole('button')).toHaveLength(1);
    expect(wednesday.getByText('Nursing Council')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Bookings on Tuesday, October 6/ })).queryAllByRole('button')).toHaveLength(0);
  });

  it('leads each block with the status and time in words so status is never colour only', () => {
    renderWeek();
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    expect(monday.getByText('Approved, 9-11 AM')).toBeInTheDocument();
    expect(monday.getByText('Pending, 10 AM-12 PM')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Bookings on Wednesday, October 7/ })).getByText('Pending, 2-3:30 PM')).toBeInTheDocument();
  });

  it('labels a conflicting pending request with the word Conflict', () => {
    renderWeek({ conflictIds: new Set([2]) });
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    const block = monday.getByRole('button', { name: /Pending booking, Conflict, Arts Guild/ });
    expect(within(block).getByText('Conflict')).toBeInTheDocument();
    expect(monday.getByRole('button', { name: /Approved booking, CS/ })).not.toHaveTextContent('Conflict');
  });

  it('reports the clicked booking', () => {
    const { onSelect } = renderWeek();
    fireEvent.click(screen.getByRole('button', { name: /Nursing Council/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it('shares lanes only inside a cluster of overlapping bookings', () => {
    renderWeek({ slots: [
      slots[0],
      { ...slots[1], id: 9, start_time: '2026-10-05T01:30:00Z', end_time: '2026-10-05T02:30:00Z' },
      { id: 10, venue_id: 9, start_time: '2026-10-05T07:00:00Z', end_time: '2026-10-05T08:00:00Z', status: 'approved', reserved_by: 'Late Club', event_title: null, venue_name: 'Gym' },
    ] });
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    expect(monday.getByRole('button', { name: /CS/ }).style.width).toBe('calc(50% - 4px)');
    expect(monday.getByRole('button', { name: /Late Club/ }).style.width).toBe('calc(100% - 4px)');
  });

  it('puts back to back bookings in the same lane, not side by side', () => {
    renderWeek({ slots: [
      slots[0],
      { ...slots[1], id: 9, start_time: '2026-10-05T03:00:00Z', end_time: '2026-10-05T04:00:00Z' },
    ] });
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    expect(monday.getByRole('button', { name: /CS/ }).style.width).toBe('calc(100% - 4px)');
    expect(monday.getByRole('button', { name: /Arts Guild/ }).style.width).toBe('calc(100% - 4px)');
  });

  it('extends the grid instead of dropping bookings outside the usual hours', () => {
    renderWeek({ slots: [
      { id: 20, venue_id: 9, start_time: '2026-10-05T14:00:00Z', end_time: '2026-10-05T15:30:00Z', status: 'pending', reserved_by: 'Night Owls', event_title: null, venue_name: 'Gym' },
      { id: 21, venue_id: 9, start_time: '2026-10-04T20:00:00Z', end_time: '2026-10-04T21:00:00Z', status: 'approved', reserved_by: 'Early Birds', event_title: null, venue_name: 'Gym' },
    ] });
    const monday = within(screen.getByRole('group', { name: /Bookings on Monday, October 5/ }));
    expect(monday.getByRole('button', { name: /Night Owls/ })).toBeInTheDocument();
    expect(monday.getByRole('button', { name: /Early Birds/ })).toBeInTheDocument();
    expect(parseFloat(monday.getByRole('button', { name: /Night Owls/ }).style.top)).toBeGreaterThan(0);
    expect(monday.getByRole('button', { name: /Early Birds/ }).style.top).toBe('0px');
    expect(within(screen.getByTestId('week-grid')).getByText(/^4 AM$/i)).toBeInTheDocument();
  });

  it('marks today with the word Today as well as colour', () => {
    vi.setSystemTime(new Date('2026-10-07T04:00:00Z'));
    renderWeek();
    expect(within(screen.getByTestId('week-grid')).getByText('Today')).toBeInTheDocument();
  });

  it('scrolls inside its own labelled region so the page never scrolls sideways', () => {
    renderWeek();
    const region = screen.getByRole('region', { name: /Week of bookings/ });
    expect(region).toHaveClass('overflow-x-auto', 'max-w-full');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('hides the venue name once a single venue is chosen', () => {
    renderWeek({ showVenue: false, slots: [slots[0]] });
    expect(screen.queryByText('Main Hall')).not.toBeInTheDocument();
  });
});
