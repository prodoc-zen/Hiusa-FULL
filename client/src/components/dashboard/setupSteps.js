import { formatDisplayText } from '../../utils/displayText.js';

// Section 7 of docs/UX_FLOW.md fixes which three steps lead for each role. The server sends its own
// order (and a few extra steps), so the client re-sorts; a key not listed goes last in server order.
const STEP_ORDER = {
  ADMIN: ['positions', 'members', 'event', 'academic', 'compliance', 'budget'],
  DEPARTMENT_HEAD: ['register', 'follow', 'review'],
  SUPER_ADMIN: ['academic-year', 'college-heads', 'requirements', 'admins', 'venues', 'announcement'],
  STUDENT: ['contact', 'event', 'statement', 'fingerprint'],
  SBO_OFFICER: ['contact', 'fingerprint', 'tasks'],
};

const ACTION_LABELS = {
  ADMIN: { positions: 'Add positions', members: 'Add members', event: 'Propose an event', academic: 'Set up programs', compliance: 'Open compliance', budget: 'Propose a budget' },
  DEPARTMENT_HEAD: { register: 'Register an organization', follow: 'Open registrations', review: 'Open approvals' },
  SUPER_ADMIN: { 'academic-year': 'Set the academic year', 'college-heads': 'Open colleges', requirements: 'Publish requirements', admins: 'Open administrators', venues: 'List venues', announcement: 'Write an announcement' },
  STUDENT: { contact: 'Add contact number', event: 'Find an event', statement: 'Open statement' },
  SBO_OFFICER: { contact: 'Add contact number', tasks: 'Open My tasks' },
};

// Steps the spec lists that the server cannot check off. They are plain links, never counted as done.
const ADVISORY_STEPS = {
  STUDENT: [{ key: 'statement', label: 'Check your statement of account', detail: 'See what you owe and your receipts, so nothing blocks your clearance.', href: '/dashboard/finance/statement-of-account' }],
  SBO_OFFICER: [{ key: 'tasks', label: 'Open My tasks', detail: 'See what your Admin assigned to you and when it is due.', href: '/dashboard/tasks/assigned-tasks' }],
};

function actionFor(role, step) {
  if (role === 'DEPARTMENT_HEAD' && step.key === 'follow') {
    return step.href?.includes('status=returned') ? 'Edit and resubmit' : 'Open registrations';
  }
  return ACTION_LABELS[role]?.[step.key];
}

/**
 * Orders the server's checklist per role, labels each button, marks the in-person fingerprint step
 * and adds the advisory links. `completed` and `total` stay the server's: only real records count.
 */
export function shapeSetup(role, setup) {
  if (!setup) return null;

  const steps = [
    ...setup.steps.map((step) => ({ ...step, action: actionFor(role, step), inPerson: step.key === 'fingerprint' })),
    ...(ADVISORY_STEPS[role] || []).map((step) => ({ ...step, done: false, advisory: true, action: actionFor(role, step) })),
  ];
  const order = STEP_ORDER[role] || [];
  const rank = (step) => { const index = order.indexOf(step.key); return index === -1 ? order.length : index; };

  return { ...setup, steps: steps.map((step, index) => ({ step, index })).sort((a, b) => rank(a.step) - rank(b.step) || a.index - b.index).map(({ step }) => step) };
}

export function setupDescription(role, organization) {
  const name = formatDisplayText(organization?.name);
  if (role === 'ADMIN' && name) return `Set up HIUSA for ${name}. Each step checks itself off once the work is done.`;
  if (role === 'DEPARTMENT_HEAD' && name) return `Your college: ${name}. Each step checks itself off once the work is done.`;
  return undefined;
}

const HIDDEN_KEY = (userKey) => `hiusa.setup.hidden.${userKey}`;

export function readSetupHidden(userKey) {
  try { return localStorage.getItem(HIDDEN_KEY(userKey)) === '1'; } catch { return false; }
}

export function writeSetupHidden(userKey) {
  try { localStorage.setItem(HIDDEN_KEY(userKey), '1'); } catch { /* the list just reappears next visit */ }
}
