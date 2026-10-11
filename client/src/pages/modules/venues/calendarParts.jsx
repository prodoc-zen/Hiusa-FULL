import { AlertTriangle, Check, Clock3 } from 'lucide-react';
import { manilaDay, manilaHour, timeLabel } from './VenueAvailabilityTimeline';

export const HOUR_PX = 52;

export const STATUS_STYLES = {
  approved: { label: 'Approved', icon: Check, block: 'border-success bg-success-tint text-success-strong', row: 'border-success/40' },
  pending: { label: 'Pending', icon: Clock3, block: 'border-dashed border-warning bg-warning-tint text-warning-strong', row: 'border-warning/50' },
};

export function statusStyle(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.pending;
}

// A word and an icon, so a clash never relies on colour alone.
export function ConflictBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-danger bg-danger-tint px-2 py-0.5 text-xs font-bold text-danger-strong ${className}`}>
      <AlertTriangle size={12} aria-hidden="true" />Conflict
    </span>
  );
}

export function hourLabel(hour) {
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

export function shortRange(start, end) {
  const from = clock(start);
  const to = clock(end);
  return from.meridiem === to.meridiem
    ? `${from.text}-${to.text} ${to.meridiem}`
    : `${from.text} ${from.meridiem}-${to.text} ${to.meridiem}`;
}

export function spanOf(slot) {
  const start = manilaHour(slot.start_time);
  const rawEnd = manilaHour(slot.end_time);
  const crossesMidnight = manilaDay(slot.end_time) !== manilaDay(slot.start_time);
  return { start, end: crossesMidnight || rawEnd <= start ? 24 : rawEnd };
}

// Lanes are shared only inside a cluster of bookings that chain-overlap, so one
// clash does not narrow every other block that day.
export function layoutColumn(items) {
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

export function describe(slot, conflict = false) {
  const parts = [
    `${statusStyle(slot.status).label} booking`,
    conflict ? 'Conflict' : null,
    slot.reserved_by,
    slot.event_title,
    slot.venue_name,
    `${timeLabel(slot.start_time)} to ${timeLabel(slot.end_time)}`,
  ];
  return parts.filter(Boolean).join(', ');
}

export function sortByStart(slots) {
  return [...slots].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}
