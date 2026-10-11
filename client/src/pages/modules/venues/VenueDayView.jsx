import { Clock3 } from 'lucide-react';
import { formatDisplayText } from '../../../utils/displayText.js';
import { manilaDay, timeLabel } from './VenueAvailabilityTimeline';
import { dayLabel, todayInManila } from './calendarDates';
import { ConflictBadge, sortByStart, statusStyle } from './calendarParts';
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
      <p className={`mb-2 text-xs font-bold uppercase ${day === todayInManila() ? 'text-brand-700' : 'text-ink-muted'}`}>{label}{day === todayInManila() ? ' (today)' : ''}</p>

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
            <h3 className="text-sm font-bold text-ink">{lane.name}</h3>
            {lane.slots.length ? (
              <ul className="mt-2 space-y-2">
                {sortByStart(lane.slots).map((slot) => {
                  const status = statusStyle(slot.status);
                  return (
                    <li key={slot.id}>
                      <button type="button" onClick={() => onSelect(slot)} className={`flex min-h-11 w-full items-start gap-2 rounded-control border bg-surface p-3 text-left text-xs outline-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent ${status.row}`}>
                        <Clock3 size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1 font-bold text-ink">
                            {timeLabel(slot.start_time)} - {timeLabel(slot.end_time)}
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${status.block}`}>{status.label}</span>
                            {conflictIds.has(slot.id) && <ConflictBadge />}
                          </span>
                          <span className="mt-0.5 block break-words font-semibold text-ink">{slot.reserved_by}</span>
                          {slot.event_title && <span className="block break-words text-ink-muted">{slot.event_title}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
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
