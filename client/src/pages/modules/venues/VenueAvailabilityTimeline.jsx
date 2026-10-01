const MAX_DAYS = 14;

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
}

function formatDayLabel(date) {
  return date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
}

function daysBetween(fromValue, toValue) {
  if (!fromValue || !toValue) return [];
  const start = startOfDay(new Date(`${fromValue}T00:00:00`));
  const end = startOfDay(new Date(`${toValue}T00:00:00`));
  const days = [];
  for (let cursor = start; cursor <= end && days.length < MAX_DAYS; cursor = new Date(cursor.getTime() + 86400000)) {
    days.push(new Date(cursor));
  }
  return days;
}

function blocksForDay(day, slots) {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const dayMs = dayEnd.getTime() - dayStart.getTime();

  return slots
    .map((slot) => {
      const slotStart = new Date(slot.start_time);
      const slotEnd = new Date(slot.end_time);
      const clampedStart = slotStart < dayStart ? dayStart : slotStart;
      const clampedEnd = slotEnd > dayEnd ? dayEnd : slotEnd;
      if (clampedEnd <= dayStart || clampedStart >= dayEnd) return null;

      const startPct = ((clampedStart.getTime() - dayStart.getTime()) / dayMs) * 100;
      const widthPct = Math.max(((clampedEnd.getTime() - clampedStart.getTime()) / dayMs) * 100, 1.5);
      return { id: slot.id, startPct, widthPct, label: `Booked, ${formatTime(slotStart)} to ${formatTime(slotEnd)}` };
    })
    .filter(Boolean);
}

export default function VenueAvailabilityTimeline({ from, to, slots }) {
  const days = daysBetween(from, to);
  const truncated = from && to && (new Date(to) - new Date(from)) / 86400000 + 1 > MAX_DAYS;

  if (days.length === 0) {
    return <p className="text-sm font-medium text-ink-muted">Choose a date range to see when this venue is already booked.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs font-semibold text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-navy-800" aria-hidden="true" />Approved booking</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-line bg-subtle" aria-hidden="true" />Open</span>
      </div>
      <ul className="space-y-2" aria-label="Venue availability by day">
        {days.map((day) => {
          const blocks = blocksForDay(day, slots);
          return (
            <li key={day.toISOString()} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs font-bold text-ink">{formatDayLabel(day)}</span>
              <div className="relative h-8 flex-1 overflow-hidden rounded-control border border-line bg-subtle">
                {blocks.map((block) => (
                  <span
                    key={block.id}
                    role="img"
                    aria-label={block.label}
                    title={block.label}
                    className="absolute top-0 h-full rounded-control bg-navy-800"
                    style={{ left: `${block.startPct}%`, width: `${block.widthPct}%` }}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {truncated && <p className="mt-2 text-xs font-medium text-ink-soft">Showing the first {MAX_DAYS} days of this range.</p>}
    </div>
  );
}
