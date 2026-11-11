const FORMULA_START = /^[=+\-@\t\r\n]/;
const FORMULA_AFTER_SPACES = /^[=+\-@]/;
// A signed amount such as -325.00 is a number, not a formula, so it is exported as it is.
const PLAIN_NUMBER = /^[+-]?\d{1,30}(?:\.\d{1,30})?$/;

export function formulaSafe(value) {
  const text = String(value ?? '');
  if (PLAIN_NUMBER.test(text)) return text;
  return FORMULA_START.test(text) || FORMULA_AFTER_SPACES.test(text.trimStart()) ? `'${text}` : text;
}

export function csvCell(value) {
  const text = formulaSafe(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
