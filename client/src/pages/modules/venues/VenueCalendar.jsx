import { useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, ErrorState, IconButton, Input, SegmentedControl, Select, Skeleton } from '../../../components/ui';
import { formatDisplayText } from '../../../utils/displayText.js';
import {
  rangeLabel, shiftAnchor, todayInManila, viewDays,
} from './calendarDates';
import { ConflictBadge, venueColor } from './calendarParts';
import VenueBookingDetails from './VenueBookingDetails';
import VenueDayView from './VenueDayView';
import VenueMonthView from './VenueMonthView';
import VenueWeekCalendar from './VenueWeekCalendar';

const VIEW_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

// A venue earns a legend entry when it is open for booking or holds a booking in this window.
function venueLegend(venues, slots) {
  const entries = venues
    .filter((venue) => venue.is_active !== false || slots.some((slot) => slot.venue_id === venue.id))
    .map((venue) => ({ id: venue.id, name: formatDisplayText(venue.name) }));
  slots.forEach((slot) => {
    if (!entries.some((entry) => entry.id === slot.venue_id)) entries.push({ id: slot.venue_id, name: formatDisplayText(slot.venue_name || 'Unknown venue') });
  });
  return entries;
}

// Day, week and month over one set of bookings. `loaded` names the view and day the bookings belong
// to, so the grid stays on screen, dimmed, while the next window loads instead of flashing empty.
export default function VenueCalendar({
  view, anchor, loaded, slots, venues, venueId, conflictIds, onVenueChange, onChange, loading, error, onRetry, truncated, onShowInQueue,
}) {
  const [selected, setSelected] = useState(null);
  const shown = loaded || { view, anchor };
  const days = viewDays(shown.view, shown.anchor);
  const initialLoad = loading && !loaded;
  const updating = loading && Boolean(loaded);
  const isEmpty = slots.length === 0;
  const unit = view;
  const legendVenues = shown.view === 'week' && !venueId ? venueLegend(venues, slots) : [];

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={(next) => onChange({ view: next, anchor })} />
        <div className="flex flex-wrap items-center gap-2">
          <IconButton icon={ChevronLeft} label={`Previous ${unit}`} variant="secondary" onClick={() => onChange({ view, anchor: shiftAnchor(view, anchor, -1) })} />
          <Button variant="secondary" onClick={() => onChange({ view, anchor: todayInManila() })}>Today</Button>
          <IconButton icon={ChevronRight} label={`Next ${unit}`} variant="secondary" onClick={() => onChange({ view, anchor: shiftAnchor(view, anchor, 1) })} />
          <Input type="date" aria-label="Jump to date" value={anchor} onChange={(event) => event.target.value && onChange({ view, anchor: event.target.value })} className="w-44" />
        </div>
        <Select aria-label="Venue to show" value={venueId} onChange={(event) => onVenueChange(event.target.value)} className="lg:w-60">
          <option value="">All venues</option>
          {venues.map((venue) => <option key={venue.id} value={venue.id}>{formatDisplayText(venue.name)}</option>)}
        </Select>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm font-bold text-ink" aria-live="polite">{rangeLabel(view, anchor)}</p>
        {updating && <span role="status" className="text-xs font-semibold text-ink-muted">Updating...</span>}
        <div className="flex flex-wrap gap-4 text-xs font-semibold text-ink-muted sm:ml-auto" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-success bg-success-tint" aria-hidden="true" />Approved</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-warning bg-warning-tint" aria-hidden="true" />Pending</span>
          <ConflictBadge />
        </div>
        {legendVenues.length > 0 && (
          <ul className="flex w-full flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-ink-muted" aria-label="Venue colours">
            {legendVenues.map((entry) => (
              <li key={entry.id} className="inline-flex items-center gap-1.5"><span data-venue-swatch className={`h-3 w-1.5 rounded-sm ${venueColor(entry.id)}`} aria-hidden="true" />{entry.name}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        {initialLoad ? (
          <div role="status" aria-label="Loading venue calendar"><Skeleton className="h-64 w-full" /></div>
        ) : error ? (
          <ErrorState title="Could not load the calendar" description={error} onRetry={onRetry} />
        ) : (
          <div aria-busy={updating || undefined} className={updating ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {truncated && (
              <p role="status" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-warning-strong"><AlertTriangle size={16} aria-hidden="true" />Showing the first {truncated.shown} bookings of {truncated.total}. Pick one venue to narrow the {unit}.</p>
            )}
            {isEmpty && (
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-ink-muted"><CalendarDays size={16} aria-hidden="true" />No pending or approved bookings this {unit}.</p>
            )}

            {shown.view === 'day' && (
              <VenueDayView day={shown.anchor} slots={slots} venues={venues} venueId={venueId} conflictIds={conflictIds} onSelect={setSelected} />
            )}
            {shown.view === 'week' && (
              <VenueWeekCalendar days={days} slots={slots} conflictIds={conflictIds} showVenue={!venueId} onSelect={setSelected} />
            )}
            {shown.view === 'month' && (
              <VenueMonthView days={days} anchor={shown.anchor} slots={slots} conflictIds={conflictIds} onSelect={setSelected} onOpenDay={(day) => onChange({ view: 'day', anchor: day })} />
            )}
          </div>
        )}
      </div>

      <VenueBookingDetails
        slot={selected}
        conflict={Boolean(selected) && conflictIds.has(selected.id)}
        onClose={() => setSelected(null)}
        onShowInQueue={onShowInQueue ? (slot) => { setSelected(null); onShowInQueue(slot); } : undefined}
      />
    </div>
  );
}
