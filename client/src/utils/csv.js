const FORMULA_START = /^[=+\-@\t\r\n]/;
const FORMULA_AFTER_SPACES = /^[=+\-@]/;

export function csvCell(value) {
  let text = String(value ?? '');
  if (FORMULA_START.test(text) || FORMULA_AFTER_SPACES.test(text.trimStart())) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
