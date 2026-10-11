import { manilaDay } from './VenueAvailabilityTimeline';

export const CALENDAR_VIEWS = ['day', 'week', 'month'];

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

export function monthStartOf(day) {
  return `${day.slice(0, 7)}-01`;
}

function monthEndOf(day) {
  const [year, month] = day.split('-').map(Number);
  return addDays(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`, -1);
}

// Keeps the day of the month where the target month has it, otherwise lands on its last day.
export function addMonths(day, count) {
  const [year, month, date] = day.split('-').map(Number);
  const index = year * 12 + (month - 1) + count;
  const first = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
  const last = Number(monthEndOf(first).slice(8));
  return `${first.slice(0, 8)}${String(Math.min(date, last)).padStart(2, '0')}`;
}

export function dayLabel(day, options) {
  return noon(day).toLocaleDateString('en-PH', { ...options, timeZone: 'Asia/Manila' });
}

// The days a view paints. A month shows whole weeks, so it spills into the neighbouring months.
export function viewDays(view, anchor) {
  if (view === 'day') return [anchor];
  if (view === 'week') {
    const start = weekStartOf(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  const start = weekStartOf(monthStartOf(anchor));
  const end = addDays(weekStartOf(monthEndOf(anchor)), 6);
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

export function viewRange(view, anchor) {
  const days = viewDays(view, anchor);
  return { first: days[0], last: days[days.length - 1] };
}

export function rangeParams(view, anchor) {
  const { first, last } = viewRange(view, anchor);
  return { from: `${first}T00:00:00+08:00`, to: `${last}T23:59:59+08:00` };
}

export function shiftAnchor(view, anchor, direction) {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  return addMonths(anchor, direction);
}

export function rangeLabel(view, anchor) {
  if (view === 'day') return dayLabel(anchor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'month') return dayLabel(anchor, { month: 'long', year: 'numeric' });
  const { first, last } = viewRange('week', anchor);
  return `${dayLabel(first, { month: 'short', day: 'numeric' })} - ${dayLabel(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
