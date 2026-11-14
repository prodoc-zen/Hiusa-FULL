const MANILA = 'Asia/Manila';

function formatPart(value, options) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: MANILA }).format(new Date(value));
}

const formatDay = (value, withYear) => formatPart(value, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
const formatTime = (value) => formatPart(value, { hour: 'numeric', minute: '2-digit' });

export function formatWhen(value) {
  return `${formatDay(value)}, ${formatTime(value)}`;
}

// "Nov 7 to Nov 15, 2026, 7:00 PM" when voting opens and closes at the same time of day, otherwise
// each end carries its own time. Same-day elections read "Nov 7, 2026, 7:00 AM to 5:00 PM".
export function formatSchedule(startValue, endValue) {
  if (!startValue || !endValue || Number.isNaN(new Date(startValue).getTime()) || Number.isNaN(new Date(endValue).getTime())) return 'Schedule not set';
  const sameDay = formatDay(startValue, true) === formatDay(endValue, true);
  const sameTime = formatTime(startValue) === formatTime(endValue);
  if (sameDay) return `${formatDay(startValue, true)}, ${formatTime(startValue)} to ${formatTime(endValue)}`;
  if (sameTime) return `${formatDay(startValue)} to ${formatDay(endValue, true)}, ${formatTime(startValue)}`;
  return `${formatWhen(startValue)} to ${formatDay(endValue, true)}, ${formatTime(endValue)}`;
}
