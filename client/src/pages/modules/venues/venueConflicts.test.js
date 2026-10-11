import { describe, expect, it } from 'vitest';
import { bookingsClashingWith, conflictingPendingIds, overlaps } from './venueConflicts';

const at = (hour, minute = 0) => `2026-10-07T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
const booking = (id, status, startHour, endHour, venueId = 8) => ({ id, venue_id: venueId, status, start_time: at(startHour), end_time: at(endHour) });

describe('venueConflicts', () => {
  it('treats back to back bookings as not overlapping', () => {
    expect(overlaps(booking(1, 'approved', 1, 2), booking(2, 'pending', 2, 3))).toBe(false);
    expect(overlaps(booking(2, 'pending', 2, 3), booking(1, 'approved', 1, 2))).toBe(false);
    expect(overlaps({ start_time: at(1), end_time: at(2) }, { start_time: at(1, 59), end_time: at(3) })).toBe(true);
  });

  it('flags a pending request that overlaps a pending or approved booking at the same venue', () => {
    const bookings = [
      booking(1, 'approved', 1, 3),
      booking(2, 'pending', 2, 4),
      booking(3, 'pending', 5, 6),
      booking(4, 'pending', 4, 5),
      booking(5, 'pending', 1, 3, 9),
    ];
    expect([...conflictingPendingIds(bookings)].sort()).toEqual([2]);
  });

  it('flags both of two pending requests that clash with each other', () => {
    expect([...conflictingPendingIds([booking(1, 'pending', 1, 3), booking(2, 'pending', 2, 4)])].sort()).toEqual([1, 2]);
  });

  it('ignores rejected and withdrawn bookings and bookings with no venue', () => {
    const rejected = booking(1, 'rejected', 1, 3);
    expect(bookingsClashingWith(booking(2, 'pending', 2, 4), [rejected, booking(3, 'withdrawn', 1, 5)])).toEqual([]);
    expect(bookingsClashingWith({ ...booking(4, 'pending', 2, 4), venue_id: null }, [booking(5, 'approved', 1, 5)])).toEqual([]);
  });
});
