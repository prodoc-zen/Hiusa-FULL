import { formatDisplayText } from '../../utils/displayText.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { RichTextBody } from '../RichText';
import { EmptyState, Field, Input, SegmentedControl, Select as HiusaSelect, Skeleton, StatusBadge, TONE_STYLES } from '../ui';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_PER_DAY = 2;

const VIEW_OPTIONS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

const VENUE_LABEL = { on_campus: 'On campus', off_campus: 'Off campus' };
const NO_FILTERS = { status: '', venue: '', organization: '', from: '', to: '' };

const STATUS_STYLE = {
  planning: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'active' },
  ongoing: { label: 'Ongoing', tone: 'active' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

function styleFor(status) {
  return STATUS_STYLE[status] || { label: status || 'Unknown', tone: 'neutral' };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, delta) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

function parseIso(iso) {
  return new Date(`${iso}T00:00:00`);
}

function buildDays(dates, month) {
  return dates.map((date) => ({ date, iso: toIso(date), inMonth: date.getMonth() === month }));
}

function weekLabel(first) {
  const last = addDays(first, 6);
  const month = (date) => date.toLocaleDateString('en-PH', { month: 'short' });
  const end = first.getMonth() === last.getMonth() ? `${last.getDate()}` : `${month(last)} ${last.getDate()}`;
  return `${month(first)} ${first.getDate()} - ${end}, ${last.getFullYear()}`;
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

function buildEventsByDate(events, from = '', to = '') {
  const map = {};
  events.forEach((event) => {
    if (!event.start_time) return;
    const start = new Date(event.start_time);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(event.end_time);
    const startIso = toIso(start);
    const rawEndIso = Number.isNaN(end.getTime()) ? '' : toIso(end);
    const endIso = rawEndIso && rawEndIso >= startIso ? rawEndIso : startIso;
    const isMultiDay = endIso !== startIso;
    const startDate = new Date(`${startIso}T00:00:00`);
    const endDate = new Date(`${endIso}T00:00:00`);
    const totalDays = isMultiDay ? Math.round((endDate - startDate) / 86400000) + 1 : 1;
    for (let i = 0; i < totalDays; i += 1) {
      const cursor = new Date(startDate);
      cursor.setDate(cursor.getDate() + i);
      const iso = toIso(cursor);
      if ((from && iso < from) || (to && iso > to)) continue;
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
      className={`flex w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-left text-xs font-semibold leading-tight transition-colors duration-150 hover:brightness-95 ${TONE_STYLES[style.tone]} ${event.isContinuation ? 'opacity-70' : ''}`}
      aria-label={`${label}, ${style.label}${event.isMultiDay ? `, ${shortDate(event.start_time)} to ${shortDate(event.end_time)}` : ''}`}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function DayPanel({ iso, eventsByDate, onSelectEvent, showDate = true }) {
  if (!iso) return null;
  const dayEvents = eventsByDate[iso] || [];
  const label = new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      {showDate && <h3 className="text-sm font-semibold text-ink">{label}</h3>}
      {dayEvents.length === 0 ? (
        <p className={`${showDate ? 'mt-3 ' : ''}text-sm text-ink-muted`}>No events scheduled on this day.</p>
      ) : (
        <ul className={`${showDate ? 'mt-3 ' : ''}space-y-2`}>
          {dayEvents.map((event) => {
            const style = styleFor(event.status);
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(event)}
                  className="flex w-full flex-col gap-1 rounded-lg border border-line p-3 text-left transition-colors duration-150 hover:border-brand-600/30 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between"
                >
                  {event.image_url && <img src={resolveAssetUrl(event.image_url)} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-control object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{formatDisplayText(event.title)}</p>
                    {event.description && <RichTextBody value={event.description} className="mt-1 line-clamp-2 text-xs text-ink-muted-strong" />}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-muted">
                      <span className="flex items-center gap-1"><Clock size={12} className="text-ink-muted" />
                        {event.isMultiDay ? `${shortDate(event.start_time)} - ${shortDate(event.end_time)}` : shortTime(event.start_time)}
                      </span>
                      {event.location && <span className="flex items-center gap-1"><MapPin size={12} className="text-ink-muted" />{event.location}</span>}
                    </div>
                  </div>
                  {event.status !== 'approved' && <StatusBadge tone={style.tone} label={style.label} className="shrink-0 self-start sm:self-center" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function eventOrganizationId(event) {
  const id = event.organization?.id ?? event.organization_id;
  return id === undefined || id === null ? '' : String(id);
}

function buildFilterOptions(events) {
  const statuses = new Set();
  const venues = new Set();
  const organizations = new Map();
  events.forEach((event) => {
    if (event.status) statuses.add(event.status);
    const venue = event.planning_details?.venue_type;
    if (VENUE_LABEL[venue]) venues.add(venue);
    const organizationId = eventOrganizationId(event);
    if (organizationId && event.organization?.name) organizations.set(organizationId, event.organization.name);
  });
  const known = Object.keys(STATUS_STYLE).filter((status) => statuses.has(status));
  return {
    statuses: [...known, ...[...statuses].filter((status) => !known.includes(status))],
    venues: Object.keys(VENUE_LABEL).filter((venue) => venues.has(venue)),
    organizations: [...organizations].map(([value, label]) => ({ value, label })),
  };
}

export default function ActivityCalendar({ events, loading, onSelectEvent, initialDate }) {
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(() => startOfDay(initialDate ? new Date(initialDate) : new Date()));
  const [selectedIso, setSelectedIso] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const panelRef = useRef(null);

  useEffect(() => {
    if (selectedIso && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedIso]);

  const rangeInvalid = Boolean(filters.from && filters.to && filters.to < filters.from);
  const rangeFrom = rangeInvalid ? '' : filters.from;
  const rangeTo = rangeInvalid ? '' : filters.to;
  const hasFilters = Object.values(filters).some(Boolean);

  const options = useMemo(() => buildFilterOptions(events || []), [events]);
  const visibleEvents = useMemo(
    () => (events || []).filter((event) => (
      (!filters.status || event.status === filters.status)
      && (!filters.venue || event.planning_details?.venue_type === filters.venue)
      && (!filters.organization || eventOrganizationId(event) === filters.organization)
    )),
    [events, filters.status, filters.venue, filters.organization]
  );
  const eventsByDate = useMemo(() => buildEventsByDate(visibleEvents, rangeFrom, rangeTo), [visibleEvents, rangeFrom, rangeTo]);
  const todayIso = toIso(new Date());
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const weeks = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const weekStart = addDays(anchor, -anchor.getDay());
  let periodDays;
  if (view === 'month') periodDays = weeks.flat().filter((day) => day.inMonth);
  else if (view === 'week') periodDays = buildDays(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), month);
  else periodDays = buildDays([anchor], month);
  const periodEventDays = periodDays.filter((day) => (eventsByDate[day.iso]?.length ?? 0) > 0);

  const monthLabel = anchor.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const periodLabel = view === 'month'
    ? monthLabel
    : view === 'week'
      ? weekLabel(weekStart)
      : anchor.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  function changeView(next) {
    if (next !== 'month' && selectedIso) setAnchor(parseIso(selectedIso));
    setSelectedIso(null);
    setView(next);
  }

  function step(delta) {
    setAnchor((current) => {
      if (view === 'month') return new Date(current.getFullYear(), current.getMonth() + delta, 1);
      return addDays(current, view === 'week' ? 7 * delta : delta);
    });
    setSelectedIso(null);
  }

  function goToday() {
    setAnchor(startOfDay(new Date()));
    setSelectedIso(view === 'month' ? todayIso : null);
  }

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    if ((key === 'from' || (key === 'to' && !filters.from)) && value) {
      const target = parseIso(value);
      if (!Number.isNaN(target.getTime())) {
        setAnchor(target);
        setSelectedIso(null);
      }
    }
  }

  function clearFilters() {
    setFilters(NO_FILTERS);
  }

  function selectDay(iso) {
    const dayEvents = eventsByDate[iso] || [];
    if (dayEvents.length === 1) {
      onSelectEvent(dayEvents[0]);
      return;
    }
    setSelectedIso((current) => (current === iso ? null : iso));
  }

  if (loading) {
    return (
      <section className="rounded-card border border-line bg-surface p-5">
        <div role="status" aria-label="Loading calendar">
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-16 sm:h-24" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const showStatus = options.statuses.length > 1 || Boolean(filters.status);
  const showVenue = options.venues.length > 1 || Boolean(filters.venue);
  const showOrganization = options.organizations.length > 1 || Boolean(filters.organization);

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{periodLabel}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={changeView} />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={`Previous ${view}`}
                className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-brand-700"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={goToday}
                aria-label="Go to today"
                className="h-11 rounded-control border border-line px-3 text-sm font-medium text-ink-muted-strong transition-colors duration-150 hover:bg-subtle hover:text-brand-700"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={`Next ${view}`}
                className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-brand-700"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-3">
          {showStatus && (
            <Field label="Status" className="w-full sm:w-44">
              <HiusaSelect value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
                <option value="">All statuses</option>
                {options.statuses.map((status) => <option key={status} value={status}>{styleFor(status).label}</option>)}
              </HiusaSelect>
            </Field>
          )}
          {showVenue && (
            <Field label="Venue" className="w-full sm:w-44">
              <HiusaSelect value={filters.venue} onChange={(event) => setFilter('venue', event.target.value)}>
                <option value="">All venues</option>
                {options.venues.map((venue) => <option key={venue} value={venue}>{VENUE_LABEL[venue]}</option>)}
              </HiusaSelect>
            </Field>
          )}
          {showOrganization && (
            <Field label="Organization" className="w-full sm:w-52">
              <HiusaSelect value={filters.organization} onChange={(event) => setFilter('organization', event.target.value)}>
                <option value="">All organizations</option>
                {options.organizations.map((organization) => <option key={organization.value} value={organization.value}>{organization.label}</option>)}
              </HiusaSelect>
            </Field>
          )}
          <Field label="From date" className="w-full sm:w-44">
            <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} className="min-h-11" />
          </Field>
          <Field label="To date" error={rangeInvalid ? 'The end date must be on or after the start date.' : undefined} className="w-full sm:w-44">
            <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} className="min-h-11" />
          </Field>
          {hasFilters && periodEventDays.length > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-11 self-end rounded-control px-2 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              Clear filters
            </button>
          )}
        </div>

        {periodEventDays.length === 0 && (
          hasFilters
            ? <EmptyState kind="filtered" title="No events match these filters" description="Try a different category or date range." onClearFilters={clearFilters} />
            : <p className="mt-4 text-sm text-ink-muted">No events scheduled for {periodLabel}.</p>
        )}

        {view === 'month' && (
          <>
            {/* Desktop / tablet grid */}
            <div className="mt-4 hidden sm:block" role="grid" aria-label={`Calendar for ${monthLabel}`}>
              <div className="grid grid-cols-7 gap-1.5" role="row">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} role="columnheader" className="px-1 py-1 text-center text-xs font-semibold text-ink-muted">
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
                          className={`min-h-[92px] rounded-lg border p-1.5 transition-colors duration-150 lg:min-h-[104px] ${
                            isSelected ? 'border-brand-600 outline outline-2 -outline-offset-2 outline-brand-600' : dayEvents.length ? 'border-brand-600/35' : 'border-line'
                          } ${dayEvents.length ? 'bg-page' : day.inMonth ? 'bg-white' : 'bg-subtle'}`}
                        >
                          <button
                            type="button"
                            onClick={() => selectDay(day.iso)}
                            aria-label={`${day.date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ', no events'}`}
                            className="flex w-full items-center justify-between"
                          >
                            <span
                              className={`grid h-6 w-6 place-items-center rounded-control text-xs font-semibold ${
                                isToday ? 'bg-brand-700 text-white' : dayEvents.length ? 'border border-brand-600/30 bg-white text-ink' : day.inMonth ? 'text-ink' : 'text-ink-soft'
                              }`}
                            >
                              {day.date.getDate()}
                            </span>
                            {dayEvents.length > 0 && <span className="text-xs font-medium tabular-nums text-ink-muted" aria-hidden="true">{dayEvents.length}</span>}
                          </button>
                          <div className="mt-1 space-y-1">
                            {visible.map((event) => (
                              <EventChip key={event.id} event={event} onSelect={onSelectEvent} />
                            ))}
                            {overflow > 0 && (
                              <button
                                type="button"
                                onClick={() => selectDay(day.iso)}
                                className="w-full rounded-control px-1.5 py-0.5 text-left text-xs font-semibold text-brand-700 hover:underline"
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
              {periodEventDays.map((day) => (
                <div key={day.iso} className="border-t border-line pt-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-control text-xs font-semibold ${day.iso === todayIso ? 'bg-brand-700 text-white' : 'bg-subtle text-ink'}`}>
                      {day.date.getDate()}
                    </span>
                    <p className="text-sm font-semibold text-ink">
                      {day.date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                    <span className="ml-auto text-xs text-ink-muted">{eventsByDate[day.iso]?.length} {eventsByDate[day.iso]?.length === 1 ? 'event' : 'events'}</span>
                  </div>
                  <div className="space-y-1.5">
                    {(eventsByDate[day.iso] || []).map((event) => {
                      const style = styleFor(event.status);
                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => onSelectEvent(event)}
                          className={`flex min-h-[42px] w-full items-center justify-between gap-2 rounded-control px-2 py-2 text-left transition-colors duration-150 hover:bg-subtle ${event.isContinuation ? 'opacity-70' : ''}`}
                        >
                          {event.image_url && <img src={resolveAssetUrl(event.image_url)} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-control object-cover" />}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {event.isContinuation ? `${formatDisplayText(event.title)} - day ${event.dayIndex} of ${event.dayTotal}` : formatDisplayText(event.title)}
                            </p>
                            <p className="text-xs font-medium text-ink-muted">
                              {event.isMultiDay ? `${shortDate(event.start_time)} - ${shortDate(event.end_time)}` : shortTime(event.start_time)}
                              {event.location ? ` - ${event.location}` : ''}
                            </p>
                          </div>
                          {event.status !== 'approved' && <StatusBadge tone={style.tone} label={style.label} className="shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {view === 'month' ? (
        <div ref={panelRef} className="hidden sm:block">
          {selectedIso && <DayPanel iso={selectedIso} eventsByDate={eventsByDate} onSelectEvent={onSelectEvent} />}
        </div>
      ) : periodEventDays.length > 0 && (
        <div className="space-y-3">
          {periodDays.map((day) => (
            <DayPanel key={day.iso} iso={day.iso} eventsByDate={eventsByDate} onSelectEvent={onSelectEvent} showDate={view === 'week'} />
          ))}
        </div>
      )}
    </div>
  );
}
