import { clearanceLifecycle } from '../../../lib/lifecycle';

// Shared vocabulary for the digital clearances screens.

export const SAO_ROLE = 'sao';

export const ROLE_PRESETS = [
  { value: 'organization', label: 'Organization' },
  { value: 'department_head', label: 'Department Head' },
  { value: SAO_ROLE, label: 'Student Affairs Office (SAO)' },
];

const ROLE_PRESET_LABEL = { adviser: 'Organization adviser', organization_treasurer: 'Organization treasurer', organization_president: 'Organization president', ...Object.fromEntries(ROLE_PRESETS.map((preset) => [preset.value, preset.label])) };

export function humanizeRole(role) {
  if (ROLE_PRESET_LABEL[role]) return ROLE_PRESET_LABEL[role];

  return String(role || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Overrides for the one clearance-signature status statusTones.js does not
// carry ("pending" and "cleared" already exist there).
export function clearanceStatusTone(status) {
  return status === 'held' ? 'warning' : undefined;
}

// Read as the student, so a signing row and the student's own checklist print the same sentence.
// A signing row passes one signature: { signatures: [row] }.
export function clearanceStageText(clearance) {
  const { nextAction } = clearanceLifecycle(clearance, 'STUDENT');
  return nextAction.tone === 'done' ? 'Cleared' : nextAction.title;
}

export function whoToSee(requiredRole) {
  return requiredRole === SAO_ROLE
    ? 'the Student Affairs Office'
    : requiredRole === 'department_head' ? 'your Department Head'
    : requiredRole === 'organization' ? 'your organization admin or officer'
    : `your organization's ${humanizeRole(requiredRole).toLowerCase()}`;
}

export function normalizeRoleInput(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}
