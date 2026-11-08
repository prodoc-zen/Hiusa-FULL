import { Clock3 } from 'lucide-react';
import { timeLabel } from './VenueAvailabilityTimeline';
import { ConflictBadge, statusStyle } from './calendarParts';

// One booking as a tappable row, for the lists that replace the time grid on a phone.
export default function VenueBookingRow({ slot, conflict = false, showVenue = false, onSelect }) {
  const status = statusStyle(slot.status);
  return (
    <button type="button" onClick={() => onSelect(slot)} className={`flex min-h-11 w-full items-start gap-2 rounded-control border bg-surface p-3 text-left text-xs outline-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent ${status.row}`}>
      <Clock3 size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1 font-semibold text-ink">
          {timeLabel(slot.start_time)} - {timeLabel(slot.end_time)}
          <span className={`rounded border px-2 py-0.5 text-xs font-medium ${status.block}`}>{status.label}</span>
          {conflict && <ConflictBadge />}
        </span>
        <span className="mt-0.5 block break-words font-semibold text-ink">{slot.reserved_by}</span>
        {slot.event_title && <span className="block break-words text-ink-muted">{slot.event_title}</span>}
        {showVenue && slot.venue_name && <span className="block break-words text-ink-muted">{slot.venue_name}</span>}
      </span>
    </button>
  );
}
