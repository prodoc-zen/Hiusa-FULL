import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { Button, ErrorState, IconButton, Select, Skeleton } from '../../../components/ui';
import { formatDisplayText } from '../../../utils/displayText.js';
import { CLOSE_HOUR, OPEN_HOUR, manilaDay, manilaHour, timeLabel } from './VenueAvailabilityTimeline';

const HOUR_PX = 44;
const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR + 1 }, (_, index) => OPEN_HOUR + index);

const STATUS_STYLES = {
  approved: { label: 'Approved', block: 'border-success bg-success-tint text-success-strong', row: 'border-success/40' },
  pending: { label: 'Pending', block: 'border-dashed border-warning bg-warning-tint text-warning-strong', row: 'border-warning/50' },
};

export function todayInManila() {
  return manilaDay(new Date());
}

function noon(day) {
  return new Date(`${day}T12:00:00+08:00`);
}

export function addDays(day, count) {
  const date = noon(day);
  date.setUTCDate(date.getUTCDate() + count);
  return manilaDay(date);
}

export function weekStartOf(day) {
  return addDays(day, -((noon(day).getUTCDay() + 6) % 7));
}

function dayLabel(day, options) {
  return noon(day).toLocaleDateString('en-PH', { ...options, timeZone: 'Asia/Manila' });
}

function hourLabel(hour) {
  return new Date(2020, 0, 1, hour).toLocaleTimeString('en-PH', { hour: 'numeric' });
}

function layoutDay(daySlots) {
  const laneEnds = [];
  const placed = [...daySlots]
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .map((slot) => {
      const start = Math.max(OPEN_HOUR, manilaHour(slot.start_time));
      const rawEnd = manilaHour(slot.end_time);
      const end = Math.min(CLOSE_HOUR, rawEnd > start ? rawEnd : CLOSE_HOUR);
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { slot, start, end, lane };
    });
  return placed.map((item) => ({ ...item, lanes: laneEnds.length }));
}

function describe(slot) {
  const status = STATUS_STYLES[slot.status] || STATUS_STYLES.pending;
  const parts = [
    `${status.label} booking`,
    slot.reserved_by,
    slot.event_title,
    slot.venue_name,
    `${timeLabel(slot.start_time)} to ${timeLabel(slot.end_time)}`,
  ];
  return parts.filter(Boolean).join(', ');
}

export default function VenueWeekCalendar({ weekStart, slots, venues, venueId, onVenueChange, onWeekChange, loading, error, onRetry }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const today = todayInManila();
  const showVenue = !venueId;
  const rangeLabel = `${dayLabel(days[0], { month: 'short', day: 'numeric' })} - ${dayLabel(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const slotsByDay = days.map((day) => slots.filter((slot) => manilaDay(slot.start_time) === day));
  const weekIsEmpty = slotsByDay.every((daySlots) => daySlots.length === 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select aria-label="Venue to show" value={venueId} onChange={(event) => onVenueChange(event.target.value)} className="sm:w-60">
          <option value="">All venues</option>
          {venues.map((venue) => <option key={venue.id} value={venue.id}>{formatDisplayText(venue.name)}</option>)}
        </Select>
        <div className="flex items-center gap-2">
          <IconButton icon={ChevronLeft} label="Previous week" variant="secondary" onClick={() => onWeekChange(addDays(weekStart, -7))} />
          <Button variant="secondary" onClick={() => onWeekChange(weekStartOf(today))}>Today</Button>
          <IconButton icon={ChevronRight} label="Next week" variant="secondary" onClick={() => onWeekChange(addDays(weekStart, 7))} />
          <p className="ml-1 text-sm font-bold text-ink" aria-live="polite">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs font-semibold text-ink-muted sm:ml-auto" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-success bg-success-tint" aria-hidden="true" />Approved</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-warning bg-warning-tint" aria-hidden="true" />Pending</span>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div role="status" aria-label="Loading venue calendar"><Skeleton className="h-64 w-full" /></div>
        ) : error ? (
          <ErrorState title="Could not load the calendar" description={error} onRetry={onRetry} />
        ) : (
          <>
            {weekIsEmpty && (
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-ink-muted"><CalendarDays size={16} aria-hidden="true" />No pending or approved bookings this week.</p>
            )}

            <div className="hidden overflow-x-auto rounded-control border border-line md:block" data-testid="week-grid">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line bg-subtle">
                  <div />
                  {days.map((day) => (
                    <div key={day} className={`border-l border-line px-2 py-2 text-center text-xs font-bold ${day === today ? 'text-brand-700' : 'text-ink-muted'}`}>
                      <span className="block uppercase">{dayLabel(day, { weekday: 'short' })}</span>
                      <span className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm ${day === today ? 'bg-brand-700 text-white' : 'text-ink'}`}>{dayLabel(day, { day: 'numeric' })}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
                  <div className="relative" style={{ height: `${(CLOSE_HOUR - OPEN_HOUR) * HOUR_PX}px` }}>
                    {HOURS.map((hour) => (
                      <span key={hour} className="absolute right-2 -translate-y-1/2 text-[11px] font-semibold text-ink-muted" style={{ top: `${(hour - OPEN_HOUR) * HOUR_PX}px` }}>{hourLabel(hour)}</span>
                    ))}
                  </div>
                  {days.map((day, index) => (
                    <div key={day} role="group" aria-label={`Bookings on ${dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}`} className="relative border-l border-line" style={{ height: `${(CLOSE_HOUR - OPEN_HOUR) * HOUR_PX}px` }}>
                      {HOURS.slice(0, -1).map((hour) => (
                        <div key={hour} className="absolute inset-x-0 border-t border-line" style={{ top: `${(hour - OPEN_HOUR) * HOUR_PX}px` }} aria-hidden="true" />
                      ))}
                      {layoutDay(slotsByDay[index]).map(({ slot, start, end, lane, lanes }) => {
                        const status = STATUS_STYLES[slot.status] || STATUS_STYLES.pending;
                        return (
                          <div
                            key={slot.id}
                            role="img"
                            aria-label={describe(slot)}
                            title={describe(slot)}
                            className={`absolute overflow-hidden rounded border px-1.5 py-0.5 text-[11px] leading-tight ${status.block}`}
                            style={{ top: `${(start - OPEN_HOUR) * HOUR_PX}px`, height: `${Math.max((end - start) * HOUR_PX, 22) - 2}px`, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                          >
                            <p className="truncate font-bold">{slot.reserved_by}</p>
                            {slot.event_title && <p className="truncate font-medium">{slot.event_title}</p>}
                            {showVenue && slot.venue_name && <p className="truncate font-medium">{slot.venue_name}</p>}
                            <p className="truncate font-semibold">{status.label}, {timeLabel(slot.start_time)} - {timeLabel(slot.end_time)}</p>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ol className="space-y-4 md:hidden" aria-label="Bookings by day" data-testid="week-agenda">
              {days.map((day, index) => (
                <li key={day}>
                  <h3 className={`text-xs font-bold uppercase ${day === today ? 'text-brand-700' : 'text-ink-muted'}`}>{dayLabel(day, { weekday: 'long', month: 'short', day: 'numeric' })}{day === today ? ' (today)' : ''}</h3>
                  {slotsByDay[index].length ? (
                    <ul className="mt-2 space-y-2">
                      {[...slotsByDay[index]].sort((a, b) => new Date(a.start_time) - new Date(b.start_time)).map((slot) => {
                        const status = STATUS_STYLES[slot.status] || STATUS_STYLES.pending;
                        return (
                          <li key={slot.id} className={`flex items-start gap-2 rounded-control border bg-surface p-3 text-xs ${status.row}`}>
                            <Clock3 size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="font-bold text-ink">{timeLabel(slot.start_time)} - {timeLabel(slot.end_time)} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${status.block}`}>{status.label}</span></p>
                              <p className="mt-0.5 font-semibold text-ink">{slot.reserved_by}</p>
                              {slot.event_title && <p className="text-ink-muted">{slot.event_title}</p>}
                              {showVenue && slot.venue_name && <p className="text-ink-muted">{slot.venue_name}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-ink-muted">Nothing booked.</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
