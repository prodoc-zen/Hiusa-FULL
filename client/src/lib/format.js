const MANILA_TZ = 'Asia/Manila';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const RELATIVE_UNITS = [
  [YEAR_MS, 'year'],
  [MONTH_MS, 'month'],
  [WEEK_MS, 'week'],
  [DAY_MS, 'day'],
  [HOUR_MS, 'hour'],
  [MINUTE_MS, 'minute'],
];

const DATE_STYLES = {
  short: { month: 'short', day: 'numeric', year: 'numeric' },
  long: { month: 'long', day: 'numeric', year: 'numeric' },
  weekday: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
};

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function toDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}

export function peso(value) {
  const amount = toFiniteNumber(value);
  const sign = amount < 0 ? '-' : '';
  const formatted = Math.abs(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}₱${formatted}`;
}

export function compactPeso(value) {
  const amount = toFiniteNumber(value);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs < 1000) return peso(amount);

  const [divisor, suffix] = abs >= 1_000_000 ? [1_000_000, 'M'] : [1_000, 'K'];
  const scaled = (abs / divisor).toFixed(1).replace(/\.0$/, '');
  return `${sign}₱${scaled}${suffix}`;
}

export function number(value) {
  return toFiniteNumber(value).toLocaleString('en-PH');
}

export function percent(value, digits = 0) {
  const amount = toFiniteNumber(value);
  return `${(amount * 100).toFixed(digits)}%`;
}

export function relativeTime(date, now = new Date()) {
  const target = toDate(date);
  const reference = toDate(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(reference.getTime())) return '';

  const diffMs = target.getTime() - reference.getTime();
  const absMs = Math.abs(diffMs);

  if (absMs < 45 * 1000) return 'just now';

  for (const [unitMs, label] of RELATIVE_UNITS) {
    if (absMs >= unitMs) {
      const count = Math.round(absMs / unitMs);
      const plural = count === 1 ? label : `${label}s`;
      return diffMs < 0 ? `${count} ${plural} ago` : `in ${count} ${plural}`;
    }
  }

  const count = Math.max(1, Math.round(absMs / MINUTE_MS));
  const plural = count === 1 ? 'minute' : 'minutes';
  return diffMs < 0 ? `${count} ${plural} ago` : `in ${count} ${plural}`;
}

export function manilaDate(date, style = 'short') {
  const target = toDate(date);
  if (Number.isNaN(target.getTime())) return '';

  const options = DATE_STYLES[style] || DATE_STYLES.short;
  return new Intl.DateTimeFormat('en-PH', { ...options, timeZone: MANILA_TZ }).format(target);
}

export function manilaTime(date) {
  const target = toDate(date);
  if (Number.isNaN(target.getTime())) return '';

  return new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: MANILA_TZ,
  }).format(target);
}

export function greetingFor(date = new Date()) {
  const target = toDate(date);
  if (Number.isNaN(target.getTime())) return 'day';

  const hourString = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: MANILA_TZ,
  }).format(target);
  const hour = Number(hourString) % 24;

  if (hour < 5) return 'evening';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
