export const ROLE_LABELS = {
  ADMIN: 'Admin',
  SBO_OFFICER: 'SBO Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

const DISPLAY_ACRONYMS = new Map(['HIUSA', 'SAO', 'SBO', 'CCS', 'PSITS', 'CCJE', 'CBA', 'CHTM', 'COE', 'CTE', 'BSIT', 'BSCS', 'BSIS', 'BSCE', 'IT', 'ICT', 'ID', 'AY', 'II', 'III', 'IV', 'GCash', 'CpE', 'BSCpE'].map((word) => [word.toLowerCase(), word]));

export function formatDisplayText(value) {
  if (typeof value !== 'string') return value;
  const firstWord = value.search(/[\p{L}\p{N}]/u);
  return value.replace(/https?:\/\/\S+|\S+@\S+|[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu, (word, index) => {
    if (/[@\d]/.test(word) || /^https?:/i.test(word)) return word;
    const canonical = DISPLAY_ACRONYMS.get(word.toLowerCase());
    if (canonical) return canonical;
    if (index > firstWord && ['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'].includes(word.toLowerCase())) return word.toLowerCase();
    return word.toLocaleLowerCase('en-PH').replace(/(^|['’])\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-PH'));
  });
}

export function humanizeIdentifier(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  if (ROLE_LABELS[text]) return ROLE_LABELS[text];

  return text
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function displayAuditValue(value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value !== 'string') return String(value);
  return /^[A-Za-z0-9]+(?:[_.][A-Za-z0-9]+)+$/.test(value)
    ? humanizeIdentifier(value)
    : value;
}
