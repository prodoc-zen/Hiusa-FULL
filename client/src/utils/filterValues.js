export function filterValues(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('[')) {
    try { const values = JSON.parse(value); if (Array.isArray(values)) return values.map(String); } catch { /* A literal value can start with a bracket. */ }
  }
  return value === '' || value == null || value === 'all' ? [] : [String(value)];
}

export function encodeFilter(values, empty = '') {
  return values.length > 1 ? JSON.stringify(values) : values[0] ?? empty;
}

export function matchesFilter(filter, value) {
  const values = filterValues(filter);
  return !values.length || values.includes(String(value));
}

export function filterLabel(value, label = (item) => item) {
  return filterValues(value).map(label).join(', ');
}
