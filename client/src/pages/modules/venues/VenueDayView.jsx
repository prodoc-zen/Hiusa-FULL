import { formatDisplayText } from '../../../utils/displayText.js';
import { manilaDay } from './VenueAvailabilityTimeline';
import { dayLabel, todayInManila } from './calendarDates';
import { sortByStart } from './calendarParts';
import VenueBookingRow from './VenueBookingRow';
import VenueTimeGrid from './VenueTimeGrid';

// A venue is a lane when it is open for booking or when it holds a booking this day.
function lanesFor(day, slots, venues, venueId) {
  const lanes = venues
    .filter((venue) => !venueId || String(venue.id) === String(venueId))
    .filter((venue) => venue.is_active !== false || slots.some((slot) => slot.venue_id === venue.id))
    .map((venue) => ({ id: venue.id, name: formatDisplayText(venue.name) }));
  slots.forEach((slot) => {
    if (!lanes.some((lane) => lane.id === slot.venue_id)) lanes.push({ id: slot.venue_id, name: formatDisplayText(slot.venue_name || 'Unknown venue') });
  });
  return lanes.map((lane) => ({ ...lane, slots: slots.filter((slot) => slot.venue_id === lane.id) }));
}

// Wide screens get one lane per venue on a shared time axis. Small screens stack the venues as
// lists, so nothing needs sideways scrolling to read.
export default function VenueDayView({ day, slots, venues, venueId, conflictIds, onSelect }) {
  const daySlots = slots.filter((slot) => manilaDay(slot.start_time) === day && (!venueId || String(slot.venue_id) === String(venueId)));
  const lanes = lanesFor(day, daySlots, venues, venueId);
  const label = dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' });
  const columns = lanes.map((lane) => ({
    key: String(lane.id),
    today: false,
    ariaLabel: `${lane.name} bookings on ${label}`,
    slots: lane.slots,
    header: <span className="block truncate text-ink">{lane.name}</span>,
  }));

  return (
    <div>
      <p className={`mb-2 text-xs font-semibold ${day === todayInManila() ? 'text-brand-700' : 'text-ink-muted'}`}>{label}{day === todayInManila() ? ' (today)' : ''}</p>

      <div className="hidden max-w-full overflow-x-auto rounded-control border border-line md:block" data-testid="day-grid">
        {columns.length ? (
          <VenueTimeGrid columns={columns} conflictIds={conflictIds} showVenue={false} onSelect={onSelect} minColumn={160} />
        ) : (
          <p className="p-4 text-sm font-medium text-ink-muted">No venues to show.</p>
        )}
      </div>

      <ol className="space-y-4 md:hidden" aria-label="Bookings by venue" data-testid="day-stack">
        {lanes.map((lane) => (
          <li key={lane.id}>
            <h3 className="text-sm font-semibold text-ink">{lane.name}</h3>
            {lane.slots.length ? (
              <ul className="mt-2 space-y-2">
                {sortByStart(lane.slots).map((slot) => (
                  <li key={slot.id}><VenueBookingRow slot={slot} conflict={conflictIds.has(slot.id)} onSelect={onSelect} /></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs font-medium text-ink-muted">Nothing booked.</p>
            )}
          </li>
        ))}
        {lanes.length === 0 && <li className="text-sm font-medium text-ink-muted">No venues to show.</li>}
      </ol>
    </div>
  );
}
