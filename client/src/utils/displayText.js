export const ROLE_LABELS = {
  ADMIN: 'Admin',
  SBO_OFFICER: 'SBO Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

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
