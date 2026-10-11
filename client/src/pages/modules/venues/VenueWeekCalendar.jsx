import { manilaDay } from './VenueAvailabilityTimeline';
import { dayLabel, todayInManila } from './calendarDates';
import VenueTimeGrid from './VenueTimeGrid';

// Seven day columns. The grid keeps its width and scrolls inside this box, never the page.
export default function VenueWeekCalendar({ days, slots, conflictIds, showVenue, onSelect }) {
  const today = todayInManila();
  const columns = days.map((day) => ({
    key: day,
    today: day === today,
    ariaLabel: `Bookings on ${dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}`,
    slots: slots.filter((slot) => manilaDay(slot.start_time) === day),
    header: (
      <>
        <span className="block uppercase">{dayLabel(day, { weekday: 'short' })}</span>
        <span className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm ${day === today ? 'bg-brand-700 text-white' : 'text-ink'}`}>{dayLabel(day, { day: 'numeric' })}</span>
        {day === today && <span className="mt-0.5 block text-xs font-bold">Today</span>}
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
