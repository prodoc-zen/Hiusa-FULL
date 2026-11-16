export const ROLE_LABELS = {
  ADMIN: 'Admin',
  SBO_OFFICER: 'SBO Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

const DISPLAY_ACRONYMS = new Map(['HIUSA', 'SAO', 'SBO', 'CCS', 'PSITS', 'CCJE', 'CBA', 'CHTM', 'COE', 'CTE', 'BS', 'BSIT', 'BSCS', 'BSIS', 'BSCE', 'IT', 'ICT', 'ID', 'AY', 'II', 'III', 'IV', 'GCash', 'CpE', 'BSCpE'].map((word) => [word.toLowerCase(), word]));

export function formatDisplayText(value) {
  if (typeof value !== 'string') return value;
  // Only text stored entirely in lower case is tidied; anything a person capitalised is shown as typed.
  if (/\p{Lu}/u.test(value)) return value;
  const firstWord = value.search(/[\p{L}\p{N}]/u);
  return value.replace(/https?:\/\/\S+|\S+@\S+|[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu, (word, index) => {
    if (/[@\d]/.test(word) || /^https?:/i.test(word)) return word;
    const canonical = DISPLAY_ACRONYMS.get(word.toLowerCase());
    if (canonical) return canonical;
    if (word.length === 1 && /\d\s*-\s*$/.test(value.slice(0, index))) return word.toLocaleUpperCase('en-PH');
    if (index > firstWord && ['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'].includes(word.toLowerCase())) return word.toLowerCase();
    return word.toLocaleLowerCase('en-PH').replace(/(^|['’])\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-PH'));
  });
}

export function humanizeIdentifier(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  if (ROLE_LABELS[text]) return ROLE_LABELS[text];

  return text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const SIGNATORY_LABELS = { treasurer: 'Treasurer', president: 'President', adviser: 'Adviser', sbo_adviser: 'SBO Adviser' };

export function signatoryLabel(role) {
  return SIGNATORY_LABELS[role] || humanizeIdentifier(role);
}

// Stored single-word statuses read as words, so a Changes row never prints a raw "rejected".
const AUDIT_STATUS_WORDS = new Set(['pending', 'approved', 'rejected', 'returned', 'cancelled', 'completed', 'resolved', 'dismissed', 'active', 'inactive', 'open', 'closed', 'paid', 'unpaid', 'draft', 'published', 'upcoming', 'verified', 'declined', 'archived']);

// An approval sent back for changes is stored as 'rejected'. When the log row says it was a return, the stored word
// reads as Returned, so the page never calls a return a rejection.
export function displayAuditValue(value, { returned = false } = {}) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value !== 'string') return String(value);
  if (returned && value === 'rejected') return 'Returned';
  if (AUDIT_STATUS_WORDS.has(value)) return humanizeIdentifier(value);
  return /^[A-Za-z0-9]+(?:[_.][A-Za-z0-9]+)+$/.test(value)
    ? humanizeIdentifier(value)
    : value;
}
