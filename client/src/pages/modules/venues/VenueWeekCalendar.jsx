import { useState } from 'react';
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ListChecks } from 'lucide-react';
import { Button, ErrorState, IconButton, Select, Skeleton, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import { formatDisplayText } from '../../../utils/displayText.js';
import { CLOSE_HOUR, OPEN_HOUR, manilaDay, manilaHour, timeLabel } from './VenueAvailabilityTimeline';

const HOUR_PX = 52;

const STATUS_STYLES = {
  approved: { label: 'Approved', icon: Check, block: 'border-success bg-success-tint text-success-strong', row: 'border-success/40' },
  pending: { label: 'Pending', icon: Clock3, block: 'border-dashed border-warning bg-warning-tint text-warning-strong', row: 'border-warning/50' },
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
  return new Date(2020, 0, 1, hour % 24).toLocaleTimeString('en-PH', { hour: 'numeric' });
}

function clock(value) {
  const decimal = manilaHour(value);
  const wholeHour = Math.floor(decimal);
  const minute = Math.round((decimal - wholeHour) * 60);
  const hour = wholeHour % 24;
  return {
    text: `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}`,
    meridiem: hour < 12 ? 'AM' : 'PM',
  };
}

function shortRange(start, end) {
  const from = clock(start);
  const to = clock(end);
  return from.meridiem === to.meridiem
    ? `${from.text}-${to.text} ${to.meridiem}`
    : `${from.text} ${from.meridiem}-${to.text} ${to.meridiem}`;
}

function spanOf(slot) {
  const start = manilaHour(slot.start_time);
  const rawEnd = manilaHour(slot.end_time);
  const crossesMidnight = manilaDay(slot.end_time) !== manilaDay(slot.start_time);
  return { start, end: crossesMidnight || rawEnd <= start ? 24 : rawEnd };
}

// Lanes are shared only inside a cluster of bookings that chain-overlap, so one
// clash does not narrow every other block that day.
function layoutDay(items) {
  const sorted = [...items].sort((a, b) => new Date(a.slot.start_time) - new Date(b.slot.start_time));
  const placed = [];
  let cluster = [];
  let laneEnds = [];
  let clusterEnd = -Infinity;

  function flush() {
    cluster.forEach((item) => placed.push({ ...item, lanes: laneEnds.length }));
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  }

  sorted.forEach((item) => {
    if (cluster.length && item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    clusterEnd = Math.max(clusterEnd, item.end);
    cluster.push({ ...item, lane });
  });
  flush();
  return placed;
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

function BookingDetails({ slot, onClose, onShowInQueue }) {
  const sameDay = slot ? manilaDay(slot.start_time) === manilaDay(slot.end_time) : true;
  const dayText = (value) => noon(manilaDay(value)).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const rows = slot ? [
    ['Organization', slot.reserved_by],
    ['Event', slot.event_title || 'Not linked'],
    ['Venue', slot.venue_name || 'Not specified'],
    ['Date', sameDay ? dayText(slot.start_time) : `${dayText(slot.start_time)} to ${dayText(slot.end_time)}`],
    ['Time', `${timeLabel(slot.start_time)} to ${timeLabel(slot.end_time)}`],
  ] : [];

  return (
    <Modal
      open={Boolean(slot)}
      title="Booking details"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {onShowInQueue && slot && (
            <Button variant="secondary" leftIcon={ListChecks} onClick={() => onShowInQueue(slot)}>Show in booking requests</Button>
          )}
        </>
      )}
    >
      {slot && (
        <dl className="grid gap-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">Status</dt>
            <dd className="mt-1"><StatusBadge status={slot.status} /></dd>
          </div>
        </dl>
      )}
    </Modal>
  );
}

export default function VenueWeekCalendar({
  weekStart, loadedWeekStart, slots, venues, venueId, onVenueChange, onWeekChange, loading, error, onRetry, truncated, onShowInQueue,
}) {
  const [selected, setSelected] = useState(null);
  const gridWeek = loadedWeekStart || weekStart;
  const days = Array.from({ length: 7 }, (_, index) => addDays(gridWeek, index));
  const today = todayInManila();
  const showVenue = !venueId;
  const rangeLabel = `${dayLabel(addDays(weekStart, 0), { month: 'short', day: 'numeric' })} - ${dayLabel(addDays(weekStart, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const slotsByDay = days.map((day) => slots.filter((slot) => manilaDay(slot.start_time) === day));
  const weekIsEmpty = slotsByDay.every((daySlots) => daySlots.length === 0);
  const timedByDay = slotsByDay.map((daySlots) => daySlots.map((slot) => ({ slot, ...spanOf(slot) })));
  const allTimed = timedByDay.flat();
  const openHour = Math.min(OPEN_HOUR, ...allTimed.map((item) => Math.floor(item.start)));
  const closeHour = Math.min(24, Math.max(CLOSE_HOUR, ...allTimed.map((item) => Math.ceil(item.end))));
  const hours = Array.from({ length: closeHour - openHour + 1 }, (_, index) => openHour + index);
  const gridHeight = `${(closeHour - openHour) * HOUR_PX}px`;
  const initialLoad = loading && !loadedWeekStart;
  const updating = loading && Boolean(loadedWeekStart);

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
          {updating && <span role="status" className="text-xs font-semibold text-ink-muted">Updating...</span>}
        </div>
        <div className="flex flex-wrap gap-4 text-xs font-semibold text-ink-muted sm:ml-auto" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-success bg-success-tint" aria-hidden="true" />Approved</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-warning bg-warning-tint" aria-hidden="true" />Pending</span>
        </div>
      </div>

      <div className="mt-4">
        {initialLoad ? (
          <div role="status" aria-label="Loading venue calendar"><Skeleton className="h-64 w-full" /></div>
        ) : error ? (
          <ErrorState title="Could not load the calendar" description={error} onRetry={onRetry} />
        ) : (
          <div aria-busy={updating || undefined} className={updating ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {truncated && (
              <p role="status" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-warning-strong"><AlertTriangle size={16} aria-hidden="true" />Showing the first {truncated.shown} bookings of {truncated.total}. Pick one venue to narrow the week.</p>
            )}
            {weekIsEmpty && (
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-ink-muted"><CalendarDays size={16} aria-hidden="true" />No pending or approved bookings this week.</p>
            )}

            <div className="hidden overflow-x-auto rounded-control border border-line lg:block" data-testid="week-grid">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line bg-subtle">
                  <div />
                  {days.map((day) => (
                    <div key={day} aria-current={day === today ? 'date' : undefined} className={`border-l border-line px-2 py-2 text-center text-xs font-bold ${day === today ? 'text-brand-700' : 'text-ink-muted'}`}>
                      <span className="block uppercase">{dayLabel(day, { weekday: 'short' })}</span>
                      <span className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm ${day === today ? 'bg-brand-700 text-white' : 'text-ink'}`}>{dayLabel(day, { day: 'numeric' })}</span>
                      {day === today && <span className="mt-0.5 block text-xs font-bold">Today</span>}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
                  <div className="relative" style={{ height: gridHeight }}>
                    {hours.map((hour) => (
                      <span key={hour} className="absolute right-2 -translate-y-1/2 text-xs font-semibold text-ink-muted" style={{ top: `${(hour - openHour) * HOUR_PX}px` }}>{hourLabel(hour)}</span>
                    ))}
                  </div>
                  {days.map((day, index) => (
                    <div key={day} role="group" aria-label={`Bookings on ${dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}`} className="relative border-l border-line" style={{ height: gridHeight }}>
                      {hours.slice(0, -1).map((hour) => (
                        <div key={hour} className="absolute inset-x-0 border-t border-line" style={{ top: `${(hour - openHour) * HOUR_PX}px` }} aria-hidden="true" />
                      ))}
                      {layoutDay(timedByDay[index]).map(({ slot, start, end, lane, lanes }) => {
                        const status = STATUS_STYLES[slot.status] || STATUS_STYLES.pending;
                        const StatusIcon = status.icon;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            aria-label={describe(slot)}
                            onClick={() => setSelected(slot)}
                            className={`absolute overflow-hidden rounded border px-1.5 text-left text-xs leading-4 outline-none focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${status.block}`}
                            style={{ top: `${(start - openHour) * HOUR_PX}px`, height: `${Math.max((end - start) * HOUR_PX, 22) - 2}px`, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                          >
                            <span className="flex items-center gap-1 truncate font-bold"><StatusIcon size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{status.label}, {shortRange(slot.start_time, slot.end_time)}</span></span>
                            <span className="block truncate font-semibold">{slot.reserved_by}</span>
                            {slot.event_title && <span className="block truncate font-medium">{slot.event_title}</span>}
                            {showVenue && slot.venue_name && <span className="block truncate font-medium">{slot.venue_name}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ol className="space-y-4 lg:hidden" aria-label="Bookings by day" data-testid="week-agenda">
              {days.map((day, index) => (
                <li key={day}>
                  <h3 className={`text-xs font-bold uppercase ${day === today ? 'text-brand-700' : 'text-ink-muted'}`}>{dayLabel(day, { weekday: 'long', month: 'short', day: 'numeric' })}{day === today ? ' (today)' : ''}</h3>
                  {slotsByDay[index].length ? (
                    <ul className="mt-2 space-y-2">
                      {[...slotsByDay[index]].sort((a, b) => new Date(a.start_time) - new Date(b.start_time)).map((slot) => {
                        const status = STATUS_STYLES[slot.status] || STATUS_STYLES.pending;
                        return (
                          <li key={slot.id}>
                            <button
                              type="button"
                              onClick={() => setSelected(slot)}
                              className={`flex min-h-11 w-full items-start gap-2 rounded-control border bg-surface p-3 text-left text-xs outline-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent ${status.row}`}
                            >
                              <Clock3 size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                              <span className="min-w-0">
                                <span className="block font-bold text-ink">{timeLabel(slot.start_time)} - {timeLabel(slot.end_time)} <span className={`ml-1 rounded-full border px-2 py-0.5 text-xs font-bold ${status.block}`}>{status.label}</span></span>
                                <span className="mt-0.5 block font-semibold text-ink">{slot.reserved_by}</span>
                                {slot.event_title && <span className="block text-ink-muted">{slot.event_title}</span>}
                                {showVenue && slot.venue_name && <span className="block text-ink-muted">{slot.venue_name}</span>}
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
            </ol>
          </div>
        )}
      </div>

      <BookingDetails slot={selected} onClose={() => setSelected(null)} onShowInQueue={onShowInQueue ? (slot) => { setSelected(null); onShowInQueue(slot); } : undefined} />
    </div>
  );
}
