import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_PER_DAY = 2;

const STATUS_STYLE = {
  planning: { label: 'Pending Approval', dot: '#F59E0B', text: 'text-[#B45309]', bg: 'bg-[#F59E0B]/10' },
  approved: { label: 'Approved', dot: '#0B8ED0', text: 'text-[#0878B7]', bg: 'bg-[#0B8ED0]/10' },
  ongoing: { label: 'Ongoing', dot: '#0B8ED0', text: 'text-[#0878B7]', bg: 'bg-[#0B8ED0]/10' },
  completed: { label: 'Completed', dot: '#16A34A', text: 'text-[#15803D]', bg: 'bg-[#16A34A]/10' },
  cancelled: { label: 'Cancelled', dot: '#DC2626', text: 'text-[#B91C1C]', bg: 'bg-[#DC2626]/10' },
};

function styleFor(status) {
  return STATUS_STYLE[status] || { label: status || 'Unknown', dot: '#94A3B8', text: 'text-slate-600', bg: 'bg-slate-100' };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function shortDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function shortTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

function buildMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i += 1) {
    const cellDate = new Date(year, month, 1 - leading + i);
    cells.push({
      date: cellDate,
      iso: toIso(cellDate),
      inMonth: cellDate.getMonth() === month,
    });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function buildEventsByDate(events) {
  const map = {};
  events.forEach((event) => {
    const startIso = String(event.start_time || '').slice(0, 10);
    if (!startIso) return;
    const rawEndIso = String(event.end_time || '').slice(0, 10);
    const endIso = rawEndIso && rawEndIso >= startIso ? rawEndIso : startIso;
    const isMultiDay = endIso !== startIso;
    const startDate = new Date(`${startIso}T00:00:00`);
    const endDate = new Date(`${endIso}T00:00:00`);
    const totalDays = isMultiDay ? Math.round((endDate - startDate) / 86400000) + 1 : 1;
    for (let i = 0; i < totalDays; i += 1) {
      const cursor = new Date(startDate);
      cursor.setDate(cursor.getDate() + i);
      const iso = toIso(cursor);
      const entry = {
        ...event,
        isMultiDay,
        isContinuation: i > 0,
        dayIndex: i + 1,
        dayTotal: totalDays,
      };
      if (!map[iso]) map[iso] = [];
      map[iso].push(entry);
    }
  });
  Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)));
  return map;
}

function EventChip({ event, onSelect }) {
  const style = styleFor(event.status);
  const label = event.isContinuation ? `${event.title} - day ${event.dayIndex} of ${event.dayTotal}` : event.title;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSelect(event); }}
      className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[10px] font-bold leading-tight transition hover:brightness-95 ${style.bg} ${style.text} ${event.isContinuation ? 'opacity-70' : ''}`}
      aria-label={`${label}, ${style.label}${event.isMultiDay ? `, ${shortDate(event.start_time)} to ${shortDate(event.end_time)}` : ''}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.dot }} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function DayPanel({ iso, eventsByDate, onSelectEvent }) {
  if (!iso) return null;
  const dayEvents = eventsByDate[iso] || [];
  const label = new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold text-[#0F172A]">{label}</h3>
      {dayEvents.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No events scheduled on this day.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {dayEvents.map((event) => {
            const style = styleFor(event.status);
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(event)}
                  className="flex w-full flex-col gap-1 rounded-lg border border-[#DDE7EF] p-3 text-left transition hover:border-[#0B8ED0]/30 hover:bg-[#F8FBFD] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[#0F172A]">{event.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                      <span className="flex items-center gap-1"><Clock size={12} className="text-slate-400" />
                        {event.isMultiDay ? `${shortDate(event.start_time)} - ${shortDate(event.end_time)}` : shortTime(event.start_time)}
                      </span>
                      {event.location && <span className="flex items-center gap-1"><MapPin size={12} className="text-slate-400" />{event.location}</span>}
                    </div>
                  </div>
                  <span className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[11px] font-bold sm:self-center ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function ActivityCalendar({ events, loading, onSelectEvent, initialDate }) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(initialDate ? new Date(initialDate) : new Date()));
  const [selectedIso, setSelectedIso] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (selectedIso && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedIso]);

  const eventsByDate = useMemo(() => buildEventsByDate(events || []), [events]);
  const todayIso = toIso(new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const weeks = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const monthLabel = viewDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

  const monthDaysWithEvents = useMemo(
    () => weeks.flat().filter((day) => day.inMonth && (eventsByDate[day.iso]?.length ?? 0) > 0),
    [weeks, eventsByDate]
  );

  function goPrev() {
    setViewDate((d) => addMonths(d, -1));
    setSelectedIso(null);
  }

  function goNext() {
    setViewDate((d) => addMonths(d, 1));
    setSelectedIso(null);
  }

  function goToday() {
    setViewDate(startOfMonth(new Date()));
    setSelectedIso(todayIso);
  }

  function selectDay(iso) {
    setSelectedIso((current) => (current === iso ? null : iso));
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="mb-4 h-8 w-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 sm:h-24" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[#0F172A]">{monthLabel}</h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous month"
              className="grid h-11 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              aria-label="Go to today"
              className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-[13px] font-bold text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next month"
              className="grid h-11 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {monthDaysWithEvents.length === 0 && (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#DDE7EF] py-8 text-center">
            <CalendarDays size={32} className="text-slate-200" />
            <p className="text-sm text-slate-400">No events scheduled for {monthLabel}.</p>
          </div>
        )}

        {/* Desktop / tablet grid */}
        <div className="mt-4 hidden sm:block" role="grid" aria-label={`Calendar for ${monthLabel}`}>
          <div className="grid grid-cols-7 gap-1.5" role="row">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} role="columnheader" className="px-1 py-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {label}
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1.5" role="row">
                {week.map((day) => {
                  const dayEvents = eventsByDate[day.iso] || [];
                  const isToday = day.iso === todayIso;
                  const isSelected = day.iso === selectedIso;
                  const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY);
                  const overflow = dayEvents.length - visible.length;
                  return (
                    <div
                      key={day.iso}
                      role="gridcell"
                      className={`min-h-[92px] rounded-lg border p-1.5 transition lg:min-h-[104px] ${
                        isSelected ? 'border-[#0B8ED0] ring-2 ring-[#16C7F3]/25' : 'border-[#E5EDF3]'
                      } ${day.inMonth ? 'bg-white' : 'bg-[#F8FBFD]'}`}
                    >
                      <button
                        type="button"
                        onClick={() => selectDay(day.iso)}
                        aria-label={`${day.date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ', no events'}`}
                        className="flex w-full items-center justify-between"
                      >
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold ${
                            isToday ? 'bg-[#0B8ED0] text-white' : day.inMonth ? 'text-[#0F172A]' : 'text-slate-300'
                          }`}
                        >
                          {day.date.getDate()}
                        </span>
                      </button>
                      <div className="mt-1 space-y-1">
                        {visible.map((event) => (
                          <EventChip key={event.id} event={event} onSelect={onSelectEvent} />
                        ))}
                        {overflow > 0 && (
                          <button
                            type="button"
                            onClick={() => selectDay(day.iso)}
                            className="w-full rounded-md px-1.5 py-0.5 text-left text-[10px] font-bold text-[#0B8ED0] hover:underline"
                          >
                            +{overflow} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Mobile agenda list */}
        <div className="mt-4 space-y-3 sm:hidden">
          {monthDaysWithEvents.map((day) => (
            <div key={day.iso} className="rounded-lg border border-[#E5EDF3] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${day.iso === todayIso ? 'bg-[#0B8ED0] text-white' : 'bg-[#F8FBFD] text-[#0F172A]'}`}>
                  {day.date.getDate()}
                </span>
                <p className="text-[13px] font-bold text-[#0F172A]">
                  {day.date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <div className="space-y-1.5">
                {(eventsByDate[day.iso] || []).map((event) => {
                  const style = styleFor(event.status);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onSelectEvent(event)}
                      className={`flex min-h-[42px] w-full items-center justify-between gap-2 rounded-lg border border-[#DDE7EF] px-3 py-2 text-left transition hover:bg-[#F8FBFD] ${event.isContinuation ? 'opacity-70' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-[#0F172A]">
                          {event.isContinuation ? `${event.title} - day ${event.dayIndex} of ${event.dayTotal}` : event.title}
                        </p>
                        <p className="text-[11px] font-medium text-slate-500">
                          {event.isMultiDay ? `${shortDate(event.start_time)} - ${shortDate(event.end_time)}` : shortTime(event.start_time)}
                          {event.location ? ` - ${event.location}` : ''}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${style.bg} ${style.text}`}>{style.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div ref={panelRef} className="hidden sm:block">
        {selectedIso && <DayPanel iso={selectedIso} eventsByDate={eventsByDate} onSelectEvent={onSelectEvent} />}
      </div>
    </div>
  );
}
