// Strict overlap, the same rule the server applies: a booking that ends exactly when
// another starts does not clash with it.
export function overlaps(a, b) {
  return new Date(a.start_time) < new Date(b.end_time) && new Date(b.start_time) < new Date(a.end_time);
}

export function bookingsClashingWith(booking, bookings) {
  if (!booking.venue_id) return [];
  return bookings.filter((other) => other.id !== booking.id
    && other.venue_id === booking.venue_id
    && ['pending', 'approved'].includes(other.status)
    && overlaps(booking, other));
}

// Ids of the pending requests that clash with another pending or approved booking for the same venue.
export function conflictingPendingIds(bookings) {
  return new Set(bookings
    .filter((booking) => booking.status === 'pending' && bookingsClashingWith(booking, bookings).length > 0)
    .map((booking) => booking.id));
}
