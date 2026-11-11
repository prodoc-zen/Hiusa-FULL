const FORMULA_START = /^[=+\-@\t\r\n]/;
const FORMULA_AFTER_SPACES = /^[=+\-@]/;

export function formulaSafe(value) {
  const text = String(value ?? '');
  return FORMULA_START.test(text) || FORMULA_AFTER_SPACES.test(text.trimStart()) ? `'${text}` : text;
}

export function csvCell(value) {
  const text = formulaSafe(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
