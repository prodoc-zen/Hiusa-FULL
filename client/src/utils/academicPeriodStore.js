export const PERIOD_KEY = 'hiusa_selected_academic_period';
export const PERIOD_EVENT = 'hiusa-period-switched';
export const PERIOD_RESET_EVENT = 'hiusa-reset-academic-period';

function parse(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

// The choice used to live in sessionStorage; carry it over once so nobody loses the period they picked.
export function readSelectedPeriod() {
  try {
    const stored = parse(localStorage.getItem(PERIOD_KEY));
    if (stored) return stored;
    const legacy = parse(sessionStorage.getItem(PERIOD_KEY));
    if (legacy) localStorage.setItem(PERIOD_KEY, JSON.stringify(legacy));
    sessionStorage.removeItem(PERIOD_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export function writeSelectedPeriod(period) {
  try {
    if (period?.id) localStorage.setItem(PERIOD_KEY, JSON.stringify(period));
    else localStorage.removeItem(PERIOD_KEY);
  } catch {
    // The period still applies to this page view when browser storage is unavailable.
  }
}

// The server ignores the semester header for a student, so the lists a student reads ask for a closed semester by query instead.
export function closedPeriodParams(role) {
  const period = role === 'STUDENT' ? readSelectedPeriod() : null;
  return period?.status === 'completed' ? { academic_semester_id: period.id } : {};
}
