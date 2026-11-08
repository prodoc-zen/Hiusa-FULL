import { manilaDay } from './VenueAvailabilityTimeline';
import { dayLabel, todayInManila } from './calendarDates';
import { sortByStart } from './calendarParts';
import useNarrowScreen from './useNarrowScreen';
import VenueBookingRow from './VenueBookingRow';
import VenueTimeGrid from './VenueTimeGrid';

// A phone has no room for seven columns, so each day becomes a heading over its bookings.
function WeekList({ days, slots, conflictIds, showVenue, onSelect, today }) {
  return (
    <ol className="space-y-4" aria-label="Bookings by day" data-testid="week-list">
      {days.map((day) => {
        const daySlots = sortByStart(slots.filter((slot) => manilaDay(slot.start_time) === day));
        return (
          <li key={day} aria-current={day === today ? 'date' : undefined}>
            <h3 className={`text-sm font-semibold ${day === today ? 'text-brand-700' : 'text-ink'}`}>
              {dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}{day === today ? ' (today)' : ''}
            </h3>
            {daySlots.length ? (
              <ul className="mt-2 space-y-2">
                {daySlots.map((slot) => (
                  <li key={slot.id}><VenueBookingRow slot={slot} conflict={conflictIds.has(slot.id)} showVenue={showVenue} onSelect={onSelect} /></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs font-medium text-ink-muted">Nothing booked.</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Seven day columns on a wide screen. The grid keeps its width and scrolls inside this box, never
// the page. A phone gets the day-by-day list instead.
export default function VenueWeekCalendar({ days, slots, conflictIds, showVenue, onSelect }) {
  const narrow = useNarrowScreen();
  const today = todayInManila();

  if (narrow) return <WeekList days={days} slots={slots} conflictIds={conflictIds} showVenue={showVenue} onSelect={onSelect} today={today} />;

  const columns = days.map((day) => ({
    key: day,
    today: day === today,
    ariaLabel: `Bookings on ${dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}`,
    slots: slots.filter((slot) => manilaDay(slot.start_time) === day),
    header: (
      <>
        <span className="block">{dayLabel(day, { weekday: 'short' })}</span>
        <span className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm ${day === today ? 'bg-brand-700 text-white' : 'text-ink'}`}>{dayLabel(day, { day: 'numeric' })}</span>
        {day === today && <span className="mt-0.5 block text-xs font-semibold">Today</span>}
      </>
    ),
  }));

  return (
    <div
      role="region"
      tabIndex={0}
      aria-label="Week of bookings. Scroll sideways to see every day."
      className="max-w-full overflow-x-auto rounded-control border border-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      data-testid="week-grid"
    >
      <VenueTimeGrid columns={columns} conflictIds={conflictIds} showVenue={showVenue} onSelect={onSelect} minColumn={112} />
    </div>
  );
}
