import { CLOSE_HOUR, OPEN_HOUR } from './VenueAvailabilityTimeline';
import {
  ConflictBadge, HOUR_PX, describe, hourLabel, layoutColumn, shortRange, spanOf, statusStyle,
} from './calendarParts';

// One time-blocked column per entry in `columns`: a day in the week view, a venue lane in the day view.
// The grid grows past the usual 5 AM to 10 PM hours rather than dropping a booking outside them.
export default function VenueTimeGrid({ columns, conflictIds, showVenue, onSelect, minColumn }) {
  const timed = columns.map((column) => column.slots.map((slot) => ({ slot, ...spanOf(slot) })));
  const all = timed.flat();
  const openHour = Math.min(OPEN_HOUR, ...all.map((item) => Math.floor(item.start)));
  const closeHour = Math.min(24, Math.max(CLOSE_HOUR, ...all.map((item) => Math.ceil(item.end))));
  const hours = Array.from({ length: closeHour - openHour + 1 }, (_, index) => openHour + index);
  const gridHeight = `${(closeHour - openHour) * HOUR_PX}px`;
  const template = `56px repeat(${columns.length}, minmax(${minColumn}px, 1fr))`;

  return (
    <div style={{ minWidth: `${56 + columns.length * minColumn}px` }}>
      <div className="grid border-b border-line bg-subtle" style={{ gridTemplateColumns: template }}>
        <div />
        {columns.map((column) => (
          <div key={column.key} aria-current={column.today ? 'date' : undefined} className={`min-w-0 border-l border-line px-2 py-2 text-center text-xs font-bold ${column.today ? 'text-brand-700' : 'text-ink-muted'}`}>
            {column.header}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: template }}>
        <div className="relative" style={{ height: gridHeight }}>
          {hours.map((hour) => (
            <span key={hour} className="absolute right-2 -translate-y-1/2 text-xs font-semibold text-ink-muted" style={{ top: `${(hour - openHour) * HOUR_PX}px` }}>{hourLabel(hour)}</span>
          ))}
        </div>
        {columns.map((column, index) => (
          <div key={column.key} role="group" aria-label={column.ariaLabel} className="relative border-l border-line" style={{ height: gridHeight }}>
            {hours.slice(0, -1).map((hour) => (
              <div key={hour} className="absolute inset-x-0 border-t border-line" style={{ top: `${(hour - openHour) * HOUR_PX}px` }} aria-hidden="true" />
            ))}
            {layoutColumn(timed[index]).map(({ slot, start, end, lane, lanes }) => {
              const status = statusStyle(slot.status);
              const StatusIcon = status.icon;
              const conflict = conflictIds.has(slot.id);
              return (
                <button
                  key={slot.id}
                  type="button"
                  aria-label={describe(slot, conflict)}
                  onClick={() => onSelect(slot)}
                  className={`absolute overflow-hidden rounded border px-1.5 text-left text-xs leading-4 outline-none focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${status.block}`}
                  style={{ top: `${(start - openHour) * HOUR_PX}px`, height: `${Math.max((end - start) * HOUR_PX, 22) - 2}px`, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                >
                  <span className="flex items-center gap-1 truncate font-bold"><StatusIcon size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{status.label}, {shortRange(slot.start_time, slot.end_time)}</span></span>
                  {conflict && <ConflictBadge className="my-0.5" />}
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
  );
}
