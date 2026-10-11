import { manilaDay } from './VenueAvailabilityTimeline';
import { dayLabel, todayInManila } from './calendarDates';
import { describe, shortRange, sortByStart, statusStyle } from './calendarParts';

const MAX_CHIPS = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Each day shows a few chips; the rest sit behind "+N more", which opens that day.
export default function VenueMonthView({ days, anchor, slots, conflictIds, onSelect, onOpenDay }) {
  const today = todayInManila();
  const month = anchor.slice(0, 7);

  return (
    <div className="max-w-full overflow-x-auto rounded-control border border-line" role="region" tabIndex={0} aria-label="Month of bookings. Scroll sideways to see every day." data-testid="month-grid">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-7 border-b border-line bg-subtle" aria-hidden="true">
          {WEEKDAYS.map((name) => <span key={name} className="px-2 py-2 text-center text-xs font-bold uppercase text-ink-muted">{name}</span>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const daySlots = sortByStart(slots.filter((slot) => manilaDay(slot.start_time) === day));
            const hidden = daySlots.length - MAX_CHIPS;
            const inMonth = day.startsWith(month);
            return (
              <div key={day} role="group" aria-label={`Bookings on ${dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}`} aria-current={day === today ? 'date' : undefined} className={`min-h-28 min-w-0 border-b border-l border-line p-1 ${inMonth ? 'bg-surface' : 'bg-subtle'}`}>
                <button type="button" onClick={() => onOpenDay(day)} aria-label={`Open ${dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}`} className={`mb-1 grid h-7 min-w-7 place-items-center rounded-full px-1 text-xs font-bold outline-none focus-visible:outline-2 focus-visible:outline-accent ${day === today ? 'bg-brand-700 text-white' : inMonth ? 'text-ink hover:bg-subtle' : 'text-ink-soft'}`}>
                  {dayLabel(day, { day: 'numeric' })}
                </button>
                {day === today && <span className="ml-1 text-xs font-bold text-brand-700">Today</span>}
                <ul className="space-y-1">
                  {daySlots.slice(0, MAX_CHIPS).map((slot) => {
                    const status = statusStyle(slot.status);
                    const conflict = conflictIds.has(slot.id);
                    return (
                      <li key={slot.id}>
                        <button type="button" aria-label={describe(slot, conflict)} title={describe(slot, conflict)} onClick={() => onSelect(slot)} className={`block w-full truncate rounded border px-1 text-left text-xs leading-5 outline-none focus-visible:outline-2 focus-visible:outline-accent ${status.block}`}>
                          {conflict && <span className="font-bold">Conflict </span>}
                          <span className="font-bold">{shortRange(slot.start_time, slot.end_time)}</span> {slot.reserved_by}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {hidden > 0 && (
                  <button type="button" onClick={() => onOpenDay(day)} className="mt-1 min-h-6 w-full rounded px-1 text-left text-xs font-bold text-brand-700 outline-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent">
                    +{hidden} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
