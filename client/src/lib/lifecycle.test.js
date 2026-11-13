import { describe, expect, it } from 'vitest';
import {
  accreditationLifecycle,
  budgetLifecycle,
  clearanceLifecycle,
  complianceRenewalLifecycle,
  electionLifecycle,
  eventLifecycle,
  financialReportLifecycle,
  grievanceLifecycle,
  orderLifecycle,
  organizationRegistrationLifecycle,
  roleLabel,
  taskLifecycle,
  toNextStepProps,
  venueBookingLifecycle,
} from './lifecycle';

const STATES = ['done', 'current', 'blocked', 'stopped', 'upcoming', 'skipped'];
const TONES = ['action', 'waiting', 'blocked', 'done'];

function assertShape(result) {
  expect(Object.keys(result).sort()).toEqual(['actorRole', 'current', 'href', 'nextAction', 'steps']);
  expect(result.steps.length).toBeGreaterThan(0);
  const keys = result.steps.map((step) => step.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const step of result.steps) {
    expect(typeof step.label).toBe('string');
    expect(STATES).toContain(step.state);
  }
  expect(result.steps.filter((step) => step.state === 'current').length).toBeLessThanOrEqual(1);
  expect(TONES).toContain(result.nextAction.tone);
  expect(typeof result.nextAction.title).toBe('string');
  expect(result.nextAction.title.length).toBeGreaterThan(0);
  if (result.current) expect(result.steps).toContain(result.current);
  if (result.nextAction.tone === 'waiting') {
    expect(result.nextAction.label).toBeUndefined();
    expect(result.nextAction.to).toBeUndefined();
  }
  expect(JSON.stringify(result)).not.toMatch(/[\u2013\u2014]/);
}

function stateMap(result) {
  return Object.fromEntries(result.steps.map((step) => [step.key, step.state]));
}

function runTable(fn, rows) {
  it.each(rows)('$name', ({ record, viewer, current, tone, title, actorRole, states, label, to, body }) => {
    const result = fn(record, viewer);
    assertShape(result);
    expect(result.current?.key ?? null).toBe(current);
    expect(result.nextAction.tone).toBe(tone);
    expect(result.nextAction.title).toBe(title);
    if (actorRole !== undefined) expect(result.actorRole).toBe(actorRole);
    if (states) expect(stateMap(result)).toEqual(states);
    if (label !== undefined) expect(result.nextAction.label).toBe(label);
    if (to !== undefined) expect(result.nextAction.to).toBe(to);
    if (body !== undefined) expect(result.nextAction.body).toBe(body);
  });
}

function expectUnknownFallback(fn, record, viewer) {
  let result;
  expect(() => { result = fn(record, viewer); }).not.toThrow();
  assertShape(result);
  expect(result.steps.every((step) => step.state === 'upcoming')).toBe(true);
  expect(result.current).toBeNull();
  expect(result.nextAction.tone).toBe('waiting');
  expect(result.actorRole).toBeNull();
  return result;
}

const ALL_LIFECYCLES = [
  ['event', eventLifecycle, 'status'],
  ['budget', budgetLifecycle, 'submission_status'],
  ['financialReport', financialReportLifecycle, 'submission_status'],
  ['election', electionLifecycle, 'status'],
  ['order', orderLifecycle, 'status'],
  ['organizationRegistration', organizationRegistrationLifecycle, 'lifecycle_status'],
  ['complianceRenewal', complianceRenewalLifecycle, 'status'],
  ['accreditation', accreditationLifecycle, 'status'],
  ['task', taskLifecycle, 'status'],
  ['grievance', grievanceLifecycle, 'status'],
  ['venueBooking', venueBookingLifecycle, 'status'],
];

describe('every lifecycle', () => {
  it.each(ALL_LIFECYCLES)('%s falls back to a neutral state for an unknown status', (_name, fn, field) => {
    const result = expectUnknownFallback(fn, { id: 1, [field]: 'something_new' }, 'ADMIN');
    expect(result.nextAction.title).toBe('Status: Something New');
  });

  it.each(ALL_LIFECYCLES)('%s survives a missing record and a missing status', (_name, fn) => {
    expectUnknownFallback(fn, undefined, 'ADMIN');
    expectUnknownFallback(fn, null, undefined);
    expectUnknownFallback(fn, {}, 'STUDENT');
  });

  it('clearance falls back neutrally for an empty list or an unknown signature status', () => {
    expectUnknownFallback(clearanceLifecycle, undefined, 'STUDENT');
    expectUnknownFallback(clearanceLifecycle, { signatures: [] }, 'STUDENT');
    expectUnknownFallback(clearanceLifecycle, { signatures: [{ required_role: 'sao', status: 'maybe' }] }, 'STUDENT');
  });

  it('roleLabel uses the spec vocabulary and null for strangers', () => {
    expect(roleLabel('SUPER_ADMIN')).toBe('SAO');
    expect(roleLabel('DEPARTMENT_HEAD')).toBe('Department Head');
    expect(roleLabel('NOPE')).toBeNull();
  });
});

describe('toNextStepProps', () => {
  it('maps a next action onto NextStep props with the owner as a label', () => {
    const props = toNextStepProps(financialReportLifecycle({ id: 3, submission_status: 'draft' }, 'ADMIN'));
    expect(props).toEqual({
      tone: 'action',
      title: 'Review and submit',
      body: 'Check the figures and signatories, then send the report to the Department Head.',
      actorRole: 'Admin',
      primary: { label: 'Review report', to: '/dashboard/finance/transaction-history?record=3' },
    });
  });

  it('leaves primary undefined when the next action has no button', () => {
    const props = toNextStepProps(financialReportLifecycle({ id: 3, submission_status: 'pending_sao' }, 'ADMIN'));
    expect(props.tone).toBe('waiting');
    expect(props.primary).toBeUndefined();
    expect(props.actorRole).toBe('SAO');
  });
});

describe('financialReportLifecycle', () => {
  const href = '/dashboard/finance/transaction-history?record=9';
  runTable(financialReportLifecycle, [
    { name: 'draft, Admin', record: { id: 9, submission_status: 'draft' }, viewer: 'ADMIN', current: 'draft', tone: 'action', title: 'Review and submit', actorRole: 'ADMIN', label: 'Review report', to: href, states: { draft: 'current', department_head: 'upcoming', sao: 'upcoming', approved: 'upcoming' } },
    { name: 'draft, Department Head waits', record: { id: 9, submission_status: 'draft' }, viewer: 'DEPARTMENT_HEAD', current: 'draft', tone: 'waiting', title: 'Waiting for the Admin to submit the report', actorRole: 'ADMIN' },
    { name: 'pending_department_head, Admin waits', record: { id: 9, submission_status: 'pending_department_head' }, viewer: 'ADMIN', current: 'department_head', tone: 'waiting', title: 'Waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD', body: 'No action needed from you.', states: { draft: 'done', department_head: 'current', sao: 'upcoming', approved: 'upcoming' } },
    { name: 'pending_department_head, Department Head acts', record: { id: 9, submission_status: 'pending_department_head' }, viewer: 'DEPARTMENT_HEAD', current: 'department_head', tone: 'action', title: 'Review this report', actorRole: 'DEPARTMENT_HEAD', label: 'Open approvals', to: '/dashboard/department-head/approvals' },
    { name: 'pending_sao, Admin waits', record: { id: 9, submission_status: 'pending_sao' }, viewer: 'ADMIN', current: 'sao', tone: 'waiting', title: 'Waiting for SAO approval', actorRole: 'SUPER_ADMIN', states: { draft: 'done', department_head: 'done', sao: 'current', approved: 'upcoming' } },
    { name: 'pending_sao, SAO acts on the financial tab', record: { id: 9, submission_status: 'pending_sao' }, viewer: 'SUPER_ADMIN', current: 'sao', tone: 'action', title: 'Review this report', actorRole: 'SUPER_ADMIN', label: 'Review report', to: '/dashboard/super-admin/compliance?tab=financial' },
    { name: 'approved', record: { id: 9, submission_status: 'approved' }, viewer: 'ADMIN', current: null, tone: 'done', title: 'Approved', actorRole: null, states: { draft: 'done', department_head: 'done', sao: 'done', approved: 'done' } },
    { name: 'rejected before the Department Head approved', record: { id: 9, submission_status: 'rejected', approval_remarks: 'Totals do not match' }, viewer: 'ADMIN', current: 'department_head', tone: 'action', title: 'Returned: fix and resubmit', actorRole: 'ADMIN', body: 'Totals do not match', label: 'Edit report', states: { draft: 'done', department_head: 'blocked', sao: 'upcoming', approved: 'upcoming' } },
    { name: 'rejected after the Department Head approved', record: { id: 9, submission_status: 'rejected', department_head_approved_at: '2026-10-01' }, viewer: 'ADMIN', current: 'sao', tone: 'action', title: 'Returned: fix and resubmit', actorRole: 'ADMIN', states: { draft: 'done', department_head: 'done', sao: 'blocked', approved: 'upcoming' } },
    { name: 'rejected, SAO sees it as waiting on the Admin', record: { id: 9, submission_status: 'rejected' }, viewer: 'SUPER_ADMIN', current: 'department_head', tone: 'waiting', title: 'Returned to the Admin for changes', actorRole: 'ADMIN' },
  ]);
});

describe('budgetLifecycle', () => {
  const href = '/dashboard/finance/budget-allocation?record=5';
  runTable(budgetLifecycle, [
    { name: 'pending_department_head, Admin waits', record: { id: 5, submission_status: 'pending_department_head' }, viewer: 'ADMIN', current: 'proposed', tone: 'waiting', title: 'Waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD', states: { proposed: 'current', second_review: 'skipped', approved: 'upcoming', spending: 'upcoming', reported: 'upcoming' } },
    { name: 'pending_department_head, Department Head acts', record: { id: 5, submission_status: 'pending_department_head' }, viewer: 'DEPARTMENT_HEAD', current: 'proposed', tone: 'action', title: 'Review this budget', actorRole: 'DEPARTMENT_HEAD', label: 'Open approvals', to: '/dashboard/department-head/approvals' },
    { name: 'pending_sao, Admin waits', record: { id: 5, submission_status: 'pending_sao' }, viewer: 'ADMIN', current: 'second_review', tone: 'waiting', title: 'Waiting for SAO approval', actorRole: 'SUPER_ADMIN', states: { proposed: 'done', second_review: 'current', approved: 'upcoming', spending: 'upcoming', reported: 'upcoming' } },
    { name: 'pending_sao, SAO acts', record: { id: 5, submission_status: 'pending_sao' }, viewer: 'SUPER_ADMIN', current: 'second_review', tone: 'action', title: 'Review this budget', actorRole: 'SUPER_ADMIN', label: 'Review budget' },
    { name: 'approved, nothing spent', record: { id: 5, submission_status: 'approved', allocated_amount: 5000 }, viewer: 'ADMIN', current: 'spending', tone: 'action', title: 'Approved: record spending against it', actorRole: 'ADMIN', label: 'Open ledger', to: '/dashboard/finance/financial-ledger', states: { proposed: 'done', second_review: 'skipped', approved: 'done', spending: 'current', reported: 'upcoming' } },
    { name: 'approved, some spent', record: { id: 5, submission_status: 'approved', allocated_amount: '5000.00', spent_amount: '1250.50' }, viewer: 'ADMIN', current: 'spending', tone: 'action', title: 'Approved: spending in progress', actorRole: 'ADMIN', body: '₱1,250.50 of ₱5,000.00 spent. Add it to the next financial report when the work is done.' },
    { name: 'approved, Department Head only sees status', record: { id: 5, submission_status: 'approved' }, viewer: 'DEPARTMENT_HEAD', current: 'spending', tone: 'waiting', title: 'Approved: the Admin records spending', actorRole: 'ADMIN' },
    { name: 'rejected at the Department Head', record: { id: 5, submission_status: 'rejected', approval_remarks: 'Too high' }, viewer: 'ADMIN', current: 'proposed', tone: 'action', title: 'Returned: edit and resubmit', actorRole: 'ADMIN', body: 'Too high', label: 'Edit budget', to: href, states: { proposed: 'blocked', second_review: 'skipped', approved: 'upcoming', spending: 'upcoming', reported: 'upcoming' } },
    { name: 'rejected at the SAO second review', record: { id: 5, submission_status: 'rejected', department_head_approved_at: '2026-10-01' }, viewer: 'ADMIN', current: 'second_review', tone: 'action', title: 'Returned: edit and resubmit', actorRole: 'ADMIN', states: { proposed: 'done', second_review: 'blocked', approved: 'upcoming', spending: 'upcoming', reported: 'upcoming' } },
    { name: 'rejected, officer waits', record: { id: 5, submission_status: 'rejected' }, viewer: 'SBO_OFFICER', current: 'proposed', tone: 'waiting', title: 'Returned to the Admin for changes', actorRole: 'ADMIN' },
  ]);
});

describe('eventLifecycle', () => {
  const href = '/dashboard/events/manage-events?record=12';
  const base = { id: 12, status: 'planning' };

  describe('planning', () => {
    runTable(eventLifecycle, [
      { name: 'no approval row, no requirements: finish the proposal', record: base, viewer: 'ADMIN', current: 'proposal', tone: 'action', title: 'Finish the proposal and submit it', actorRole: 'ADMIN', label: 'Open the proposal', to: href, states: { proposal: 'current', requirements: 'skipped', approval: 'upcoming', funding: 'skipped', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'no approval row, an officer waits', record: base, viewer: 'SBO_OFFICER', current: 'proposal', tone: 'waiting', title: 'Waiting for the Admin to submit the proposal', actorRole: 'ADMIN' },
      { name: 'SAO requirements required and not submitted', record: { ...base, requirements_required: true, requirements_submitted: false }, viewer: 'ADMIN', current: 'requirements', tone: 'action', title: 'Submit the SAO event files', actorRole: 'ADMIN', label: 'Submit event files', states: { proposal: 'done', requirements: 'current', approval: 'upcoming', funding: 'skipped', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'SAO requirements required and not submitted, SAO waits', record: { ...base, requirements_required: true }, viewer: 'SUPER_ADMIN', current: 'requirements', tone: 'waiting', title: 'Waiting for the Admin to submit the SAO event files', actorRole: 'ADMIN' },
      { name: 'approval pending with Department Head, Admin waits', record: { ...base, approval_status: 'pending', approval_required_role: 'DEPARTMENT_HEAD', requirements_required: false }, viewer: 'ADMIN', current: 'approval', tone: 'waiting', title: 'Waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD', body: 'No action needed from you.', states: { proposal: 'done', requirements: 'skipped', approval: 'current', funding: 'skipped', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'approval pending with Department Head, the head opens the approval row', record: { ...base, approval_id: 77, approval_status: 'pending', approval_required_role: 'DEPARTMENT_HEAD' }, viewer: 'DEPARTMENT_HEAD', current: 'approval', tone: 'action', title: 'Review this event', actorRole: 'DEPARTMENT_HEAD', label: 'Open approval', to: '/dashboard/department-head/approvals?record=77' },
      { name: 'approval pending with the SAO after a requirements upload', record: { ...base, approval_status: 'pending', approval_required_role: 'SUPER_ADMIN', requirements_required: true, requirements_submitted: true }, viewer: 'ADMIN', current: 'approval', tone: 'waiting', title: 'Waiting for SAO approval', actorRole: 'SUPER_ADMIN', states: { proposal: 'done', requirements: 'done', approval: 'current', funding: 'skipped', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'approval pending with the SAO, the SAO opens that event in Compliance event reviews', record: { ...base, organization_id: 5, approval_status: 'pending', approval_required_role: 'SUPER_ADMIN' }, viewer: 'SUPER_ADMIN', current: 'approval', tone: 'action', title: 'Review this event', actorRole: 'SUPER_ADMIN', label: 'Open approval', to: '/dashboard/super-admin/compliance?tab=event-reviews&organization=5&event=12' },
      { name: 'approval pending with the SAO, an event without its organization still opens the Event reviews tab', record: { ...base, approval_status: 'pending', approval_required_role: 'SUPER_ADMIN' }, viewer: 'SUPER_ADMIN', current: 'approval', tone: 'action', title: 'Review this event', actorRole: 'SUPER_ADMIN', label: 'Open approval', to: '/dashboard/super-admin/compliance?tab=event-reviews' },
      { name: 'approval pending, approver role absent but requirements flag says SAO', record: { ...base, approval_status: 'pending', requirements_required: true, requirements_submitted: true }, viewer: 'ADMIN', current: 'approval', tone: 'waiting', title: 'Waiting for SAO approval', actorRole: 'SUPER_ADMIN' },
      { name: 'approval pending, approver role absent but requirements flag says none: Department Head', record: { ...base, approval_status: 'pending', requirements_required: false }, viewer: 'ADMIN', current: 'approval', tone: 'waiting', title: 'Waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD' },
      { name: 'approval pending, nothing tells who approves: say so truthfully', record: { ...base, approval_status: 'pending' }, viewer: 'ADMIN', current: 'approval', tone: 'waiting', title: 'Waiting for approval', actorRole: null },
      { name: 'approval rejected (the status stays planning)', record: { ...base, approval_status: 'rejected', approval_remarks: 'Pick another date', approval_required_role: 'DEPARTMENT_HEAD' }, viewer: 'ADMIN', current: 'approval', tone: 'action', title: 'Returned: read the remarks, edit, resubmit', actorRole: 'ADMIN', body: 'Pick another date', label: 'Edit and resubmit', states: { proposal: 'done', requirements: 'skipped', approval: 'blocked', funding: 'skipped', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'approval rejected, the head sees it as waiting on the Admin', record: { ...base, approval_status: 'rejected' }, viewer: 'DEPARTMENT_HEAD', current: 'approval', tone: 'waiting', title: 'Returned to the Admin for changes', actorRole: 'ADMIN' },
    ]);
  });

  describe('approved', () => {
    const approved = { ...base, status: 'approved', approval_status: 'approved' };
    runTable(eventLifecycle, [
      { name: 'needs a budget and none exists', record: { ...approved, requires_budget: true, budgets: [] }, viewer: 'ADMIN', current: 'funding', tone: 'action', title: 'Propose the event budget', actorRole: 'ADMIN', label: 'Propose budget', to: '/dashboard/finance/budget-allocation?event=12', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'current', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'budget pending the Department Head', record: { ...approved, requires_budget: true, budgets: [{ id: 3, submission_status: 'pending_department_head' }] }, viewer: 'ADMIN', current: 'funding', tone: 'waiting', title: 'Budget waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD' },
      { name: 'budget pending the Department Head, the head acts', record: { ...approved, budgets: [{ id: 3, submission_status: 'pending_department_head' }] }, viewer: 'DEPARTMENT_HEAD', current: 'funding', tone: 'action', title: 'Review the event budget', actorRole: 'DEPARTMENT_HEAD', label: 'Open approvals' },
      { name: 'budget pending the SAO', record: { ...approved, budgets: [{ id: 3, submission_status: 'pending_sao' }] }, viewer: 'ADMIN', current: 'funding', tone: 'waiting', title: 'Budget waiting for SAO approval', actorRole: 'SUPER_ADMIN' },
      { name: 'budget rejected', record: { ...approved, requires_budget: true, budgets: [{ id: 3, submission_status: 'rejected', approval_remarks: 'Cut transport' }] }, viewer: 'ADMIN', current: 'funding', tone: 'action', title: 'Budget returned: edit and resubmit', actorRole: 'ADMIN', body: 'Cut transport', label: 'Edit budget', to: '/dashboard/finance/budget-allocation?record=3', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'blocked', prepare: 'upcoming', run: 'upcoming', report: 'upcoming' } },
      { name: 'a pending budget wins over an older rejected one', record: { ...approved, budgets: [{ id: 4, submission_status: 'rejected' }, { id: 3, submission_status: 'pending_department_head' }] }, viewer: 'ADMIN', current: 'funding', tone: 'waiting', title: 'Budget waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD' },
      { name: 'no budget needed: straight to prepare, no tasks yet', record: { ...approved, requires_budget: false, tasks_count: 0 }, viewer: 'ADMIN', current: 'prepare', tone: 'action', title: 'Plan the tasks', actorRole: 'ADMIN', label: 'Plan tasks', to: '/dashboard/events/event-planner?event=12', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'skipped', prepare: 'current', run: 'upcoming', report: 'upcoming' } },
      { name: 'budget approved, tasks partly done', record: { ...approved, requires_budget: true, budgets: [{ id: 3, submission_status: 'approved' }], tasks_count: 5, completed_tasks_count: 2 }, viewer: 'ADMIN', current: 'prepare', tone: 'action', title: '2 of 5 tasks done', actorRole: 'ADMIN', label: 'Open tasks', to: '/dashboard/tasks/task-board?event=12', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'done', prepare: 'current', run: 'upcoming', report: 'upcoming' } },
      { name: 'tasks partly done, officer goes to My tasks', record: { ...approved, tasks_count: 5, completed_tasks_count: 2 }, viewer: 'SBO_OFFICER', current: 'prepare', tone: 'action', title: '2 of 5 tasks done', actorRole: 'ADMIN', to: '/dashboard/tasks/assigned-tasks' },
      { name: 'all tasks done: ready to run', record: { ...approved, tasks_count: 4, completed_tasks_count: 4 }, viewer: 'ADMIN', current: 'prepare', tone: 'action', title: 'Ready to run', actorRole: 'ADMIN', body: 'All 4 tasks are done. Mark the event ongoing when it starts.' },
      { name: 'preparing, a student only watches', record: { ...approved, tasks_count: 1 }, viewer: 'STUDENT', current: 'prepare', tone: 'waiting', title: 'The organization is preparing this event', actorRole: 'ADMIN' },
      { name: 'status planning with an approved approval row is treated as approved', record: { ...base, approval_status: 'approved', tasks_count: 0 }, viewer: 'ADMIN', current: 'prepare', tone: 'action', title: 'Plan the tasks', actorRole: 'ADMIN' },
    ]);
  });

  describe('ongoing, completed and cancelled', () => {
    runTable(eventLifecycle, [
      { name: 'ongoing: check people in', record: { ...base, status: 'ongoing', approval_status: 'approved', present_count: 18 }, viewer: 'SBO_OFFICER', current: 'run', tone: 'action', title: 'Check people in', actorRole: 'ADMIN', body: '18 checked in so far.', label: 'Open check-in', to: '/dashboard/events/check-in?event=12', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'skipped', prepare: 'done', run: 'current', report: 'upcoming' } },
      { name: 'ongoing without an attendance count', record: { ...base, status: 'ongoing' }, viewer: 'ADMIN', current: 'run', tone: 'action', title: 'Check people in', actorRole: 'ADMIN', body: 'The event is under way. Record attendance as people arrive.' },
      { name: 'ongoing with an unapproved budget keeps funding honest', record: { ...base, status: 'ongoing', requires_budget: true, budgets: [{ id: 3, submission_status: 'pending_department_head' }] }, viewer: 'ADMIN', current: 'run', tone: 'action', title: 'Check people in', actorRole: 'ADMIN', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'upcoming', prepare: 'done', run: 'current', report: 'upcoming' } },
      { name: 'ongoing, a student sees it as happening now', record: { ...base, status: 'ongoing' }, viewer: 'STUDENT', current: 'run', tone: 'waiting', title: 'This event is happening now', actorRole: 'ADMIN' },
      { name: 'completed with no report yet', record: { ...base, status: 'completed' }, viewer: 'ADMIN', current: 'report', tone: 'action', title: 'Prepare the event financial report', actorRole: 'ADMIN', label: 'Prepare report', to: '/dashboard/finance/transaction-history?event=12', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'skipped', prepare: 'done', run: 'done', report: 'current' } },
      { name: 'completed with no report, the head waits', record: { ...base, status: 'completed' }, viewer: 'DEPARTMENT_HEAD', current: 'report', tone: 'waiting', title: 'Waiting for the Admin to prepare the event report', actorRole: 'ADMIN' },
      { name: 'completed with a draft report', record: { ...base, status: 'completed', financial_report: { id: 8, submission_status: 'draft' } }, viewer: 'ADMIN', current: 'report', tone: 'action', title: 'Review and submit', actorRole: 'ADMIN', label: 'Review report', to: '/dashboard/finance/transaction-history?record=8' },
      { name: 'completed with a report at the Department Head', record: { ...base, status: 'completed', financial_report: { id: 8, submission_status: 'pending_department_head' } }, viewer: 'ADMIN', current: 'report', tone: 'waiting', title: 'Waiting for Department Head approval', actorRole: 'DEPARTMENT_HEAD' },
      { name: 'completed with a report at the SAO', record: { ...base, status: 'completed', financial_report: { id: 8, submission_status: 'pending_sao' } }, viewer: 'ADMIN', current: 'report', tone: 'waiting', title: 'Waiting for SAO approval', actorRole: 'SUPER_ADMIN' },
      { name: 'completed with a returned report', record: { ...base, status: 'completed', financial_report: { id: 8, submission_status: 'rejected' } }, viewer: 'ADMIN', current: 'report', tone: 'action', title: 'Returned: fix and resubmit', actorRole: 'ADMIN', states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'skipped', prepare: 'done', run: 'done', report: 'blocked' } },
      { name: 'completed with an approved report is finished', record: { ...base, status: 'completed', financial_report: { id: 8, submission_status: 'approved' } }, viewer: 'ADMIN', current: null, tone: 'done', title: 'Event complete', actorRole: null, states: { proposal: 'done', requirements: 'skipped', approval: 'done', funding: 'skipped', prepare: 'done', run: 'done', report: 'done' } },
      { name: 'cancelled', record: { ...base, status: 'cancelled' }, viewer: 'ADMIN', current: null, tone: 'blocked', title: 'Cancelled', actorRole: null, states: { proposal: 'done', requirements: 'skipped', approval: 'stopped', funding: 'skipped', prepare: 'skipped', run: 'skipped', report: 'skipped' } },
    ]);
  });

  it('labels the approval step with the approver and keeps seven steps', () => {
    const result = eventLifecycle({ ...base, approval_status: 'pending', approval_required_role: 'SUPER_ADMIN' }, 'ADMIN');
    expect(result.steps.map((step) => step.label)).toEqual(['Proposal', 'Requirements', 'Approval', 'Funding', 'Prepare', 'Run', 'Report']);
    expect(result.steps[2].actor).toBe('SAO');
  });

  it('puts the task count in the Prepare note', () => {
    const result = eventLifecycle({ ...base, status: 'approved', tasks_count: 3, completed_tasks_count: 1 }, 'ADMIN');
    expect(result.steps[4].note).toBe('1 of 3 tasks done');
  });

  it('tolerates every S2 field being absent on a pending approval and never throws', () => {
    expect(() => eventLifecycle({ id: 1, status: 'planning', approval_status: 'pending', budgets: undefined }, undefined)).not.toThrow();
  });
});

describe('electionLifecycle', () => {
  const href = '/dashboard/elections/manage-elections?record=2';
  const open = { id: 2, start_time: '2026-11-03T08:00:00+08:00', end_time: '2026-11-05T17:00:00+08:00' };
  runTable(electionLifecycle, [
    { name: 'pending_approval, Admin waits', record: { ...open, status: 'pending_approval' }, viewer: 'ADMIN', current: 'submitted', tone: 'waiting', title: 'Awaiting Department Head review', actorRole: 'DEPARTMENT_HEAD', states: { submitted: 'current', ballot: 'upcoming', locked: 'upcoming', voting: 'upcoming', results: 'upcoming' } },
    { name: 'pending_approval, the head acts', record: { ...open, status: 'pending_approval' }, viewer: 'DEPARTMENT_HEAD', current: 'submitted', tone: 'action', title: 'Review this election', actorRole: 'DEPARTMENT_HEAD', label: 'Open approvals', to: '/dashboard/department-head/approvals' },
    { name: 'pending_approval with a rejected approval row', record: { ...open, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Wrong dates' }, viewer: 'ADMIN', current: 'submitted', tone: 'action', title: 'Returned: edit and resubmit', actorRole: 'ADMIN', body: 'Wrong dates', label: 'Edit election', to: href, states: { submitted: 'blocked', ballot: 'upcoming', locked: 'upcoming', voting: 'upcoming', results: 'upcoming' } },
    { name: 'upcoming, ballot not finalized: build it', record: { ...open, status: 'upcoming', finalized_at: null }, viewer: 'ADMIN', current: 'ballot', tone: 'action', title: 'Build the ballot', actorRole: 'ADMIN', label: 'Open ballot setup', to: href, body: 'Add party lists, then candidates for every position, then finalize.', states: { submitted: 'done', ballot: 'current', locked: 'upcoming', voting: 'upcoming', results: 'upcoming' } },
    { name: 'upcoming, ballot not finalized, an officer goes to candidates', record: { ...open, status: 'upcoming' }, viewer: 'SBO_OFFICER', current: 'ballot', tone: 'action', title: 'Build the ballot', actorRole: 'ADMIN', to: '/dashboard/elections/manage-candidates' },
    { name: 'upcoming, ballot not finalized, a student waits', record: { ...open, status: 'upcoming' }, viewer: 'STUDENT', current: 'ballot', tone: 'waiting', title: 'Waiting for the ballot to be built', actorRole: 'ADMIN' },
    { name: 'upcoming, ballot finalized, a student sees the date', record: { ...open, status: 'upcoming', finalized_at: '2026-10-30T10:00:00+08:00' }, viewer: 'STUDENT', current: 'locked', tone: 'waiting', title: 'Ballot locked: voting opens on Nov 3, 2026', actorRole: 'ADMIN', states: { submitted: 'done', ballot: 'done', locked: 'current', voting: 'upcoming', results: 'upcoming' } },
    { name: 'upcoming, ballot finalized, the Admin opens voting', record: { ...open, status: 'upcoming', finalized_at: '2026-10-30T10:00:00+08:00' }, viewer: 'ADMIN', current: 'locked', tone: 'action', title: 'Ballot locked: open voting when it starts', actorRole: 'ADMIN', label: 'Open election', body: 'Voting is scheduled for Nov 3, 2026. Open it from the election page.' },
    { name: 'active, a student who has not voted', record: { ...open, status: 'active', finalized_at: 'x' }, viewer: 'STUDENT', current: 'voting', tone: 'action', title: 'Cast your ballot', actorRole: 'STUDENT', label: 'Vote now', to: '/elections/2/vote', states: { submitted: 'done', ballot: 'done', locked: 'done', voting: 'current', results: 'upcoming' } },
    { name: 'active, a student who has voted', record: { ...open, status: 'active', finalized_at: 'x', has_voted: true }, viewer: 'STUDENT', current: 'voting', tone: 'done', title: 'You have voted', actorRole: null },
    { name: 'active, the Admin monitors', record: { ...open, status: 'active', finalized_at: 'x' }, viewer: 'ADMIN', current: 'voting', tone: 'waiting', title: 'Voting is open until Nov 5, 2026', actorRole: 'STUDENT' },
    { name: 'closed with results hidden, the Admin releases', record: { ...open, status: 'closed', finalized_at: 'x', results_visible: false }, viewer: 'ADMIN', current: 'results', tone: 'action', title: 'Closed: release the results', actorRole: 'ADMIN', label: 'Open election', states: { submitted: 'done', ballot: 'done', locked: 'done', voting: 'done', results: 'current' } },
    { name: 'closed with results hidden, a student waits', record: { ...open, status: 'closed', finalized_at: 'x', results_visible: false }, viewer: 'STUDENT', current: 'results', tone: 'waiting', title: 'Closed: results not released yet', actorRole: 'ADMIN' },
    { name: 'closed with results released', record: { ...open, status: 'closed', finalized_at: 'x', results_visible: true }, viewer: 'STUDENT', current: null, tone: 'done', title: 'Results released', actorRole: null, label: 'View results', to: '/dashboard/elections/election-results', states: { submitted: 'done', ballot: 'done', locked: 'done', voting: 'done', results: 'done' } },
  ]);

  it('tells the Admin voting opens by itself while the start time is still ahead, with no action to take', () => {
    const start = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const result = electionLifecycle({ ...open, start_time: start, status: 'upcoming', finalized_at: '2026-10-30T10:00:00+08:00' }, 'ADMIN');
    expect(result.nextAction.tone).toBe('waiting');
    expect(result.nextAction.title).toMatch(/^Ballot locked: voting opens on [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(result.nextAction.body).toMatch(/^Voting opens by itself on .+ at .+\.$/);
    expect(result.nextAction.label).toBeUndefined();
    expect(result.nextAction.to).toBeUndefined();
    expect(JSON.stringify(result.nextAction)).not.toMatch(/Open it from the election page|open voting when it starts/);
  });
});

describe('electionLifecycle for an election where students file their own candidacy', () => {
  const base = {
    id: 7,
    title: 'SBO Election',
    status: 'upcoming',
    phase: 'scheduled',
    submitted_at: '2026-10-01T08:00:00+08:00',
    filing_starts_at: '2026-12-01T08:00:00+08:00',
    filing_ends_at: '2026-12-05T17:00:00+08:00',
    screening_starts_at: '2026-12-06T08:00:00+08:00',
    screening_ends_at: '2026-12-08T17:00:00+08:00',
    campaign_starts_at: '2026-12-09T08:00:00+08:00',
    campaign_ends_at: '2026-12-14T17:00:00+08:00',
    start_time: '2026-12-15T08:00:00+08:00',
    end_time: '2026-12-16T17:00:00+08:00',
    results_publish_at: '2026-12-18T09:00:00+08:00',
    finalized_at: null,
  };
  const info = '/dashboard/elections/election-info?record=7';
  const applications = '/dashboard/elections/applications?record=7';
  const results = '/dashboard/elections/election-results?record=7';
  const stepKeys = ['proposal', 'filing', 'screening', 'campaign', 'voting', 'results'];
  const states = (...values) => Object.fromEntries(stepKeys.map((key, index) => [key, values[index]]));
  const closed = { ...base, status: 'closed', finalized_at: 'x' };

  runTable(electionLifecycle, [
    { name: 'draft: the Admin finishes it and submits', record: { ...base, status: 'pending_approval', phase: null, submitted_at: null }, viewer: 'ADMIN', current: 'proposal', tone: 'action', title: 'Finish the draft and submit it', actorRole: 'ADMIN', label: 'Edit election', to: '/dashboard/elections/manage-elections?edit=7' },
    { name: 'draft: others see it is still being written', record: { ...base, status: 'pending_approval', phase: null, submitted_at: null }, viewer: 'STUDENT', current: 'proposal', tone: 'waiting', title: 'Waiting for the Admin to submit the election', actorRole: 'ADMIN' },
    { name: 'pending approval: the Department Head decides', record: { ...base, status: 'pending_approval', phase: null }, viewer: 'DEPARTMENT_HEAD', current: 'proposal', tone: 'action', title: 'Review this election', actorRole: 'DEPARTMENT_HEAD', label: 'Open approvals', to: '/dashboard/department-head/approvals' },
    { name: 'pending approval: the Admin waits', record: { ...base, status: 'pending_approval', phase: null }, viewer: 'ADMIN', current: 'proposal', tone: 'waiting', title: 'Awaiting Department Head review', actorRole: 'DEPARTMENT_HEAD' },
    { name: 'returned for changes: the Admin edits', record: { ...base, status: 'pending_approval', phase: null, approval_status: 'rejected', approval_remarks: 'Move voting later' }, viewer: 'ADMIN', current: 'proposal', tone: 'action', title: 'Returned: edit and resubmit', actorRole: 'ADMIN', body: 'Move voting later', label: 'Edit election', states: states('blocked', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming') },
    { name: 'rejected for good: no action, with the remarks', record: { ...base, status: 'pending_approval', phase: null, approval_status: 'rejected', declined_at: '2026-10-02T08:00:00+08:00', approval_remarks: 'Not within the semester' }, viewer: 'ADMIN', current: null, tone: 'blocked', title: 'Rejected by the Department Head', actorRole: null, body: 'Not within the semester', states: states('stopped', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming') },
    { name: 'scheduled: filing opens on a date', record: base, viewer: 'STUDENT', current: 'filing', tone: 'waiting', title: 'Filing opens on Dec 1, 2026', actorRole: null },
    { name: 'scheduled: the Admin waits too', record: base, viewer: 'ADMIN', current: 'filing', tone: 'waiting', title: 'Filing opens on Dec 1, 2026' },
    { name: 'filing: the Admin waits for students', record: { ...base, phase: 'filing' }, viewer: 'ADMIN', current: 'filing', tone: 'waiting', title: 'Students are filing until Dec 5, 2026', states: states('done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming') },
    { name: 'filing: a student files', record: { ...base, phase: 'filing' }, viewer: 'STUDENT', current: 'filing', tone: 'action', title: 'File your candidacy', actorRole: 'STUDENT', label: 'File your candidacy', to: info },
    { name: 'filing: the Department Head waits', record: { ...base, phase: 'filing' }, viewer: 'DEPARTMENT_HEAD', current: 'filing', tone: 'waiting', title: 'Students are filing until Dec 5, 2026' },
    { name: 'screening: the Admin screens the pending applications', record: { ...base, phase: 'screening', application_counts: { pending_review: 4, for_revision: 1, approved: 2, rejected: 0, withdrawn: 0 } }, viewer: 'ADMIN', current: 'screening', tone: 'action', title: 'Screen 4 applications', actorRole: 'ADMIN', label: 'Screen 4 applications', to: applications, states: states('done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming') },
    { name: 'screening: one application reads in the singular', record: { ...base, phase: 'screening', application_counts: { pending_review: 1 } }, viewer: 'ADMIN', current: 'screening', tone: 'action', title: 'Screen 1 application', label: 'Screen 1 application', to: applications },
    { name: 'screening: nothing pending, the Admin waits', record: { ...base, phase: 'screening', application_counts: { pending_review: 0 } }, viewer: 'ADMIN', current: 'screening', tone: 'waiting', title: 'No applications are waiting for review' },
    { name: 'screening: a student waits', record: { ...base, phase: 'screening' }, viewer: 'STUDENT', current: 'screening', tone: 'waiting', title: 'The Admin is screening applications' },
    { name: 'campaign: voting opens on a date', record: { ...base, phase: 'campaign' }, viewer: 'STUDENT', current: 'campaign', tone: 'waiting', title: 'Voting opens on Dec 15, 2026', states: states('done', 'done', 'done', 'current', 'upcoming', 'upcoming') },
    { name: 'voting: a student who has not voted', record: { ...base, status: 'active', phase: 'voting', finalized_at: 'x' }, viewer: 'STUDENT', current: 'voting', tone: 'action', title: 'Cast your ballot', label: 'Vote now', to: '/elections/7/vote' },
    { name: 'voting: a student who has voted', record: { ...base, status: 'active', phase: 'voting', finalized_at: 'x', has_voted: true }, viewer: 'STUDENT', current: 'voting', tone: 'done', title: 'You have voted', actorRole: null },
    { name: 'voting: the Admin monitors', record: { ...base, status: 'active', phase: 'voting', finalized_at: 'x' }, viewer: 'ADMIN', current: 'voting', tone: 'waiting', title: 'Voting is open until Dec 16, 2026' },
    { name: 'canvassing: results publish on a date', record: { ...closed, phase: 'canvassing' }, viewer: 'ADMIN', current: 'results', tone: 'waiting', title: 'Results publish on Dec 18, 2026', states: states('done', 'done', 'done', 'done', 'done', 'current') },
    { name: 'canvassing: a runoff is required, the Admin schedules it', record: { ...closed, phase: 'canvassing', positions: [{ id: 1, result_status: 'decided' }, { id: 2, result_status: 'runoff_required' }] }, viewer: 'ADMIN', current: 'results', tone: 'action', title: 'Set the runoff schedule', actorRole: 'ADMIN', label: 'Set the runoff schedule', to: results },
    { name: 'canvassing: a runoff is required, a student waits', record: { ...closed, phase: 'canvassing', positions: [{ id: 2, result_status: 'runoff_required' }] }, viewer: 'STUDENT', current: 'results', tone: 'waiting', title: 'Waiting for the Admin to set the runoff schedule' },
    { name: 'canvassing: a runoff is scheduled', record: { ...closed, phase: 'canvassing', runoff_starts_at: '2026-12-20T08:00:00+08:00', positions: [{ id: 2, result_status: 'runoff_scheduled' }] }, viewer: 'ADMIN', current: 'results', tone: 'waiting', title: 'Runoff voting opens on Dec 20, 2026' },
    { name: 'runoff: a student votes in the runoff', record: { ...closed, phase: 'runoff', open_round: 2, runoff_ends_at: '2026-12-21T17:00:00+08:00' }, viewer: 'STUDENT', current: 'results', tone: 'action', title: 'Vote in the runoff', actorRole: 'STUDENT', label: 'Vote in the runoff', to: '/elections/7/vote' },
    { name: 'runoff: a student who has voted waits', record: { ...closed, phase: 'runoff', open_round: 2, has_voted: true, runoff_ends_at: '2026-12-21T17:00:00+08:00' }, viewer: 'STUDENT', current: 'results', tone: 'done', title: 'You have voted in the runoff' },
    { name: 'runoff: the Admin waits for the runoff to end', record: { ...closed, phase: 'runoff', open_round: 2, runoff_ends_at: '2026-12-21T17:00:00+08:00' }, viewer: 'ADMIN', current: 'results', tone: 'waiting', title: 'Runoff voting is open until Dec 21, 2026' },
    { name: 'tie resolution: the Department Head resolves', record: { ...closed, phase: 'tie_resolution' }, viewer: 'DEPARTMENT_HEAD', current: 'results', tone: 'action', title: 'Resolve the tie', actorRole: 'DEPARTMENT_HEAD', label: 'Resolve the tie', to: results },
    { name: 'tie resolution: the Admin waits for the Department Head', record: { ...closed, phase: 'tie_resolution' }, viewer: 'ADMIN', current: 'results', tone: 'waiting', title: 'Waiting for the Department Head', actorRole: 'DEPARTMENT_HEAD' },
    { name: 'tie resolution: the SAO resolves for a university-wide organization', record: { ...closed, phase: 'tie_resolution', approval_required_role: 'SUPER_ADMIN' }, viewer: 'SUPER_ADMIN', current: 'results', tone: 'action', title: 'Resolve the tie', label: 'Resolve the tie' },
    { name: 'completed: results released', record: { ...closed, phase: 'completed', results_visible: true }, viewer: 'STUDENT', current: null, tone: 'done', title: 'Results released', label: 'View results', to: results, states: states('done', 'done', 'done', 'done', 'done', 'done') },
    { name: 'suspended: the Admin resumes', record: { ...base, phase: 'filing', suspended_at: '2026-12-02T08:00:00+08:00', halt_reason: 'Venue fire drill' }, viewer: 'ADMIN', current: 'filing', tone: 'action', title: 'Suspended: Venue fire drill', actorRole: 'ADMIN', label: 'Resume election', states: states('done', 'blocked', 'upcoming', 'upcoming', 'upcoming', 'upcoming') },
    { name: 'suspended: a student waits', record: { ...base, phase: 'filing', suspended_at: '2026-12-02T08:00:00+08:00', halt_reason: 'Venue fire drill' }, viewer: 'STUDENT', current: 'filing', tone: 'waiting', title: 'Suspended: Venue fire drill' },
    { name: 'cancelled: no action', record: { ...base, phase: 'cancelled', cancelled_at: '2026-12-02T08:00:00+08:00', halt_reason: 'Not enough candidates' }, viewer: 'ADMIN', current: null, tone: 'blocked', title: 'Cancelled: Not enough candidates', actorRole: null },
  ]);

  it('puts the alert text in the body, in the blocked tone, and keeps the step and the action', () => {
    const result = electionLifecycle({ ...base, phase: 'screening', phase_alert: 'Voting could not start: a position has no candidates.', application_counts: { pending_review: 2 } }, 'ADMIN');
    assertShape(result);
    expect(result.nextAction.tone).toBe('blocked');
    expect(result.nextAction.body).toBe('Voting could not start: a position has no candidates.');
    expect(result.nextAction.label).toBe('Screen 2 applications');
    expect(result.current.key).toBe('screening');
    expect(result.current.state).toBe('blocked');
  });

  it('shows the alert to every role, even one that only waits', () => {
    const result = electionLifecycle({ ...base, phase: 'campaign', phase_alert: 'Voting could not start.' }, 'STUDENT');
    assertShape(result);
    expect(result.nextAction.tone).toBe('blocked');
    expect(result.nextAction.body).toBe('Voting could not start.');
  });

  it('ignores an alert on a cancelled election', () => {
    const result = electionLifecycle({ ...base, phase: 'cancelled', cancelled_at: 'x', halt_reason: 'Stopped', phase_alert: 'Old alert' }, 'ADMIN');
    expect(result.nextAction.title).toBe('Cancelled: Stopped');
    expect(result.nextAction.body).not.toBe('Old alert');
  });

  it('falls back to the status when a filing election has no phase yet', () => {
    expect(electionLifecycle({ ...base, status: 'active', phase: null, finalized_at: 'x' }, 'STUDENT').nextAction.title).toBe('Cast your ballot');
    expect(electionLifecycle({ ...base, status: 'something_new', phase: null }, 'ADMIN').nextAction.title).toBe('Status: Something New');
  });

  it('leaves an election without filing dates on the existing steps', () => {
    const result = electionLifecycle({ id: 2, status: 'upcoming', finalized_at: null, phase: null }, 'ADMIN');
    expect(result.steps.map((step) => step.key)).toEqual(['submitted', 'ballot', 'locked', 'voting', 'results']);
  });
});

describe('orderLifecycle', () => {
  const buyerHref = '/dashboard/merchandise/my-orders?record=6';
  const staffHref = '/dashboard/merchandise/manage-orders?record=6';
  runTable(orderLifecycle, [
    { name: 'pending without proof, the buyer', record: { id: 6, status: 'pending', payment_method: 'cash' }, viewer: 'STUDENT', current: 'reserved', tone: 'action', title: 'Pay cash at pickup, or submit GCash proof', actorRole: 'STUDENT', label: 'Open order', to: buyerHref, states: { reserved: 'current', proof: 'upcoming', paid: 'upcoming', claimed: 'upcoming' } },
    { name: 'pending without proof, an officer waits for the buyer', record: { id: 6, status: 'pending' }, viewer: 'SBO_OFFICER', current: 'reserved', tone: 'waiting', title: 'Waiting for the buyer to pay', actorRole: 'STUDENT' },
    { name: 'pending with proof, the buyer waits', record: { id: 6, status: 'pending', payment_proof_url: '/p.png', officer_review_status: 'pending' }, viewer: 'STUDENT', current: 'proof', tone: 'waiting', title: 'Waiting for payment check', actorRole: 'SBO_OFFICER', states: { reserved: 'done', proof: 'current', paid: 'upcoming', claimed: 'upcoming' } },
    { name: 'pending with proof, an officer verifies', record: { id: 6, status: 'pending', payment_proof_url: '/p.png' }, viewer: 'SBO_OFFICER', current: 'proof', tone: 'action', title: 'Verify the payment', actorRole: 'SBO_OFFICER', label: 'Review order', to: staffHref },
    { name: 'pending with proof, an Admin verifies', record: { id: 6, status: 'pending', payment_proof_url: '/p.png' }, viewer: 'ADMIN', current: 'proof', tone: 'action', title: 'Verify the payment', actorRole: 'SBO_OFFICER' },
    { name: 'paid, the buyer shows the token', record: { id: 6, status: 'paid', claim_token: 'ABCD1234EFGH5678' }, viewer: 'STUDENT', current: 'paid', tone: 'action', title: 'Show token ABCD1234EFGH5678 at the claim desk', actorRole: 'STUDENT', states: { reserved: 'done', proof: 'done', paid: 'current', claimed: 'upcoming' } },
    { name: 'paid without a visible token', record: { id: 6, status: 'paid' }, viewer: 'STUDENT', current: 'paid', tone: 'action', title: 'Show your claim token at the claim desk', actorRole: 'STUDENT' },
    { name: 'paid, an officer releases at the desk', record: { id: 6, status: 'paid' }, viewer: 'SBO_OFFICER', current: 'paid', tone: 'action', title: 'Release at the claim desk', actorRole: 'STUDENT', label: 'Open claim desk', to: '/dashboard/merchandise/claim-tokens' },
    { name: 'claimed', record: { id: 6, status: 'claimed', claimed_at: '2026-10-08T09:00:00+08:00' }, viewer: 'STUDENT', current: null, tone: 'done', title: 'Collected on Oct 8, 2026', actorRole: null, states: { reserved: 'done', proof: 'done', paid: 'done', claimed: 'done' } },
    { name: 'cancelled with a reason', record: { id: 6, status: 'cancelled', review_remarks: 'Wrong reference number' }, viewer: 'STUDENT', current: null, tone: 'blocked', title: 'Cancelled', actorRole: null, body: 'Cancelled: Wrong reference number', states: { reserved: 'done', proof: 'stopped', paid: 'skipped', claimed: 'skipped' } },
    { name: 'cancelled without a reason', record: { id: 6, status: 'cancelled' }, viewer: 'SBO_OFFICER', current: null, tone: 'blocked', title: 'Cancelled', actorRole: null, body: 'This order was cancelled.' },
  ]);
});

describe('organizationRegistrationLifecycle', () => {
  it('sends nobody to an administrators page, because that page no longer exists, sends only the Department Head to Give access of a college organization, and never tells the SAO to add a college organization head', () => {
    for (const record of [{ id: 4, lifecycle_status: 'active', administrators_count: 0 }, { id: 4, lifecycle_status: 'active', administrators_count: 0, is_university_wide: true }]) {
      for (const viewer of ['SUPER_ADMIN', 'DEPARTMENT_HEAD']) {
        const result = organizationRegistrationLifecycle(record, viewer);
        const gives = viewer === 'DEPARTMENT_HEAD' && !record.is_university_wide;
        expect(result.nextAction.label).toBe(gives ? 'Give access' : undefined);
        expect(result.nextAction.to).toBe(gives ? '/dashboard/department-head/org/4?tab=people' : undefined);
        expect(JSON.stringify(result)).not.toContain('super-admin/admins');
      }
    }
    const college = organizationRegistrationLifecycle({ id: 4, lifecycle_status: 'active', administrators_count: 0 }, 'SUPER_ADMIN');
    expect(JSON.stringify(college)).not.toMatch(/SAO to (add|assign)/);
    expect(college.steps.find((step) => step.key === 'administrator').actor).toBe('Department Head');
  });

  const saoReview = '/dashboard/super-admin/organizations?status=pending&review=4';
  runTable(organizationRegistrationLifecycle, [
    { name: 'pending, the SAO reviews', record: { id: 4, lifecycle_status: 'pending' }, viewer: 'SUPER_ADMIN', current: 'review', tone: 'action', title: 'Review the registration', actorRole: 'SUPER_ADMIN', label: 'Review registration', to: saoReview, states: { registered: 'done', review: 'current', administrator: 'upcoming', first_use: 'upcoming' } },
    { name: 'pending, the Department Head waits', record: { id: 4, lifecycle_status: 'pending' }, viewer: 'DEPARTMENT_HEAD', current: 'review', tone: 'waiting', title: 'Waiting for SAO review', actorRole: 'SUPER_ADMIN', body: 'No action needed from you.' },
    { name: 'returned, the Department Head edits', record: { id: 4, lifecycle_status: 'returned', review_remarks: 'Missing constitution' }, viewer: 'DEPARTMENT_HEAD', current: 'review', tone: 'action', title: 'Returned: edit and resubmit', actorRole: 'DEPARTMENT_HEAD', body: 'Missing constitution', label: 'Edit and resubmit', to: '/dashboard/department-head/organizations?status=returned&record=4', states: { registered: 'done', review: 'blocked', administrator: 'upcoming', first_use: 'upcoming' } },
    { name: 'returned, the SAO waits', record: { id: 4, lifecycle_status: 'returned' }, viewer: 'SUPER_ADMIN', current: 'review', tone: 'waiting', title: 'Waiting for the Department Head to resubmit', actorRole: 'DEPARTMENT_HEAD' },
    { name: 'active college organization with no administrator, the Department Head names one', record: { id: 4, lifecycle_status: 'active', administrators_count: 0 }, viewer: 'DEPARTMENT_HEAD', current: 'administrator', tone: 'action', title: 'Name the organization head', actorRole: 'DEPARTMENT_HEAD', label: 'Give access', to: '/dashboard/department-head/org/4?tab=people', body: 'This organization has no Admin. Open it and use Give access to name its Organization head so they can sign in and manage it.', states: { registered: 'done', review: 'done', administrator: 'current', first_use: 'upcoming' } },
    { name: 'active college organization with no administrator, the SAO waits for the Department Head', record: { id: 4, lifecycle_status: 'active', administrators_count: 0 }, viewer: 'SUPER_ADMIN', current: 'administrator', tone: 'waiting', title: 'Approved: waiting for the Department Head to name the organization head', actorRole: 'DEPARTMENT_HEAD' },
    { name: 'active college organization with administrators_count as a string zero', record: { id: 4, lifecycle_status: 'active', administrators_count: '0' }, viewer: 'DEPARTMENT_HEAD', current: 'administrator', tone: 'action', title: 'Name the organization head', actorRole: 'DEPARTMENT_HEAD' },
    { name: 'active university-wide organization with no administrator, the SAO adds one', record: { id: 4, lifecycle_status: 'active', administrators_count: 0, is_university_wide: true }, viewer: 'SUPER_ADMIN', current: 'administrator', tone: 'action', title: 'Add the Admin account', actorRole: 'SUPER_ADMIN', body: 'This organization is open to every college and has no dean. Add its Admin from the Organizations list so an administrator can sign in and manage it.' },
    { name: 'active university-wide organization with no administrator, an Admin waits for the SAO', record: { id: 4, lifecycle_status: 'active', administrators_count: 0, is_university_wide: true }, viewer: 'ADMIN', current: 'administrator', tone: 'waiting', title: 'Approved: waiting for the SAO to add the Admin account', actorRole: 'SUPER_ADMIN' },
    { name: 'active with an administrator and no setup data', record: { id: 4, lifecycle_status: 'active', administrators_count: 1 }, viewer: 'DEPARTMENT_HEAD', current: null, tone: 'done', title: 'Administrator can sign in', actorRole: null, states: { registered: 'done', review: 'done', administrator: 'done', first_use: 'done' } },
    { name: 'active with an administrator, setup unfinished, the Admin', record: { id: 4, lifecycle_status: 'active', administrators_count: 1, setup_steps_done: 1, setup_steps_total: 3 }, viewer: 'ADMIN', current: 'first_use', tone: 'action', title: 'Finish your 2 setup steps', actorRole: 'ADMIN', label: 'Open dashboard', to: '/dashboard/admin', states: { registered: 'done', review: 'done', administrator: 'done', first_use: 'current' } },
    { name: 'active with an administrator, one setup step left', record: { id: 4, lifecycle_status: 'active', administrators_count: 1, setup_steps_done: 2, setup_steps_total: 3 }, viewer: 'ADMIN', current: 'first_use', tone: 'action', title: 'Finish your 1 setup step', actorRole: 'ADMIN' },
    { name: 'active with an administrator, setup unfinished, the head waits', record: { id: 4, lifecycle_status: 'active', administrators_count: 1, setup_steps_done: 0, setup_steps_total: 3 }, viewer: 'DEPARTMENT_HEAD', current: 'first_use', tone: 'waiting', title: 'The administrator is finishing setup', actorRole: 'ADMIN' },
    { name: 'active with an administrator, setup complete', record: { id: 4, lifecycle_status: 'active', administrators_count: 1, setup_steps_done: 3, setup_steps_total: 3 }, viewer: 'ADMIN', current: null, tone: 'done', title: 'Administrator can sign in', actorRole: null },
    { name: 'active with the administrator count missing', record: { id: 4, lifecycle_status: 'active' }, viewer: 'SUPER_ADMIN', current: 'administrator', tone: 'done', title: 'Approved and active', actorRole: null },
    { name: 'archived', record: { id: 4, lifecycle_status: 'archived' }, viewer: 'SUPER_ADMIN', current: null, tone: 'blocked', title: 'Archived: read only', actorRole: null, states: { registered: 'done', review: 'done', administrator: 'stopped', first_use: 'skipped' } },
  ]);

  it('links the SAO to the review drawer while pending and to the organization overview afterwards', () => {
    expect(organizationRegistrationLifecycle({ id: 4, lifecycle_status: 'pending' }, 'SUPER_ADMIN').href).toBe(saoReview);
    expect(organizationRegistrationLifecycle({ id: 4, lifecycle_status: 'active', administrators_count: 1 }, 'SUPER_ADMIN').href).toBe('/dashboard/super-admin/organizations/4');
    expect(organizationRegistrationLifecycle({ id: 4, lifecycle_status: 'pending' }, 'DEPARTMENT_HEAD').href).toBe('/dashboard/department-head/organizations?record=4');
  });
});

describe('complianceRenewalLifecycle', () => {
  runTable(complianceRenewalLifecycle, [
    { name: 'not_submitted with a deadline', record: { status: 'not_submitted', requirement_name: 'Annual report', deadline_at: '2026-11-30T00:00:00+08:00' }, viewer: 'ADMIN', current: 'required', tone: 'action', title: 'Submit Annual report by Nov 30, 2026', actorRole: 'ADMIN', label: 'Open compliance', to: '/dashboard/compliance', states: { required: 'current', submitted: 'upcoming', approved: 'upcoming' } },
    { name: 'not_submitted without a deadline', record: { status: 'not_submitted', requirement_name: 'Annual report' }, viewer: 'ADMIN', current: 'required', tone: 'action', title: 'Submit Annual report', actorRole: 'ADMIN' },
    { name: 'not_submitted, the SAO waits', record: { status: 'not_submitted', requirement_name: 'Annual report' }, viewer: 'SUPER_ADMIN', current: 'required', tone: 'waiting', title: 'Waiting for the Admin to submit', actorRole: 'ADMIN' },
    { name: 'submitted, Admin waits', record: { status: 'submitted' }, viewer: 'ADMIN', current: 'submitted', tone: 'waiting', title: 'Waiting for SAO review', actorRole: 'SUPER_ADMIN', states: { required: 'done', submitted: 'current', approved: 'upcoming' } },
    { name: 'submitted, the SAO opens the review queue tab', record: { status: 'submitted', requirement_name: 'annual_report' }, viewer: 'SUPER_ADMIN', current: 'submitted', tone: 'action', title: 'Review the submission', actorRole: 'SUPER_ADMIN', label: 'Open review queue', to: '/dashboard/super-admin/compliance?tab=review', body: 'Annual Report is waiting for your decision.' },
    { name: 'approved', record: { status: 'approved' }, viewer: 'ADMIN', current: null, tone: 'done', title: 'Approved', actorRole: null, states: { required: 'done', submitted: 'done', approved: 'done' } },
    { name: 'returned with remarks', record: { status: 'returned', remarks: 'Unreadable scan' }, viewer: 'ADMIN', current: 'submitted', tone: 'action', title: 'Returned: replace the file', actorRole: 'ADMIN', body: 'Unreadable scan', states: { required: 'done', submitted: 'blocked', approved: 'upcoming' } },
    { name: 'returned, the SAO waits', record: { status: 'returned' }, viewer: 'SUPER_ADMIN', current: 'submitted', tone: 'waiting', title: 'Returned to the Admin for a new file', actorRole: 'ADMIN' },
  ]);
});

describe('accreditationLifecycle', () => {
  runTable(accreditationLifecycle, [
    { name: 'incomplete shows the count', record: { status: 'incomplete', approved: 2, total: 5 }, viewer: 'ADMIN', current: 'requirements', tone: 'action', title: 'Submit the missing requirements', actorRole: 'ADMIN', body: '2 of 5 requirements approved', states: { requirements: 'current', review: 'upcoming', accredited: 'upcoming' } },
    { name: 'incomplete without counts', record: { status: 'incomplete' }, viewer: 'ADMIN', current: 'requirements', tone: 'action', title: 'Submit the missing requirements', actorRole: 'ADMIN', body: 'Some requirements have not been submitted yet.' },
    { name: 'returned', record: { status: 'returned', approved: 3, total: 5 }, viewer: 'ADMIN', current: 'requirements', tone: 'action', title: 'Replace the returned files', actorRole: 'ADMIN', states: { requirements: 'blocked', review: 'upcoming', accredited: 'upcoming' } },
    { name: 'pending_review, Admin waits', record: { status: 'pending_review', approved: 4, total: 5 }, viewer: 'ADMIN', current: 'review', tone: 'waiting', title: 'Waiting for SAO review', actorRole: 'SUPER_ADMIN', states: { requirements: 'done', review: 'current', accredited: 'upcoming' } },
    { name: 'pending_review, the SAO acts', record: { status: 'pending_review' }, viewer: 'SUPER_ADMIN', current: 'review', tone: 'action', title: 'Review the submissions', actorRole: 'SUPER_ADMIN', label: 'Open review queue', to: '/dashboard/super-admin/compliance?tab=review' },
    { name: 'accredited', record: { status: 'accredited', approved: 5, total: 5 }, viewer: 'ADMIN', current: null, tone: 'done', title: 'Accredited', actorRole: null, body: '5 of 5 requirements approved', states: { requirements: 'done', review: 'done', accredited: 'done' } },
    { name: 'not_applicable', record: { status: 'not_applicable' }, viewer: 'ADMIN', current: null, tone: 'done', title: 'No requirements this year', actorRole: null, states: { requirements: 'skipped', review: 'skipped', accredited: 'skipped' } },
  ]);
});

describe('taskLifecycle', () => {
  runTable(taskLifecycle, [
    { name: 'pending, the officer starts it with no route (the page binds the click)', record: { id: 1, status: 'pending' }, viewer: 'SBO_OFFICER', current: 'todo', tone: 'action', title: 'Start this task', actorRole: 'SBO_OFFICER', label: 'Start task', to: undefined, states: { todo: 'current', in_progress: 'upcoming', done: 'upcoming' } },
    { name: 'pending, the Admin waits for the officer', record: { id: 1, status: 'pending' }, viewer: 'ADMIN', current: 'todo', tone: 'waiting', title: 'Waiting for the assigned officer', actorRole: 'SBO_OFFICER' },
    { name: 'in_progress', record: { id: 1, status: 'in_progress' }, viewer: 'SBO_OFFICER', current: 'in_progress', tone: 'action', title: 'Mark it done when finished', actorRole: 'SBO_OFFICER', label: 'Mark done', states: { todo: 'done', in_progress: 'current', done: 'upcoming' } },
    { name: 'completed', record: { id: 1, status: 'completed' }, viewer: 'SBO_OFFICER', current: null, tone: 'done', title: 'Completed', actorRole: null, states: { todo: 'done', in_progress: 'done', done: 'done' } },
    { name: 'overdue with a deadline', record: { id: 1, status: 'overdue', deadline: '2026-10-01T17:00:00+08:00' }, viewer: 'SBO_OFFICER', current: 'in_progress', tone: 'action', title: 'Overdue since Oct 1, 2026', actorRole: 'SBO_OFFICER', label: 'Update status', states: { todo: 'upcoming', in_progress: 'blocked', done: 'upcoming' } },
    { name: 'overdue without a deadline', record: { id: 1, status: 'overdue' }, viewer: 'SBO_OFFICER', current: 'in_progress', tone: 'action', title: 'Overdue', actorRole: 'SBO_OFFICER' },
    { name: 'overdue, the Admin waits', record: { id: 1, status: 'overdue', deadline: '2026-10-01T17:00:00+08:00' }, viewer: 'ADMIN', current: 'in_progress', tone: 'waiting', title: 'Overdue since Oct 1, 2026', actorRole: 'SBO_OFFICER', body: 'Waiting for the assigned officer.' },
  ]);

  it('links an officer to My tasks and an Admin to the board', () => {
    expect(taskLifecycle({ id: 1, status: 'pending' }, 'SBO_OFFICER').href).toBe('/dashboard/tasks/assigned-tasks?record=1');
    expect(taskLifecycle({ id: 1, status: 'pending' }, 'ADMIN').href).toBe('/dashboard/tasks/task-board?record=1');
  });
});

describe('grievanceLifecycle', () => {
  const org = { id: 3, addressed_to: 'organization' };
  const sao = { id: 3, addressed_to: 'sao' };
  runTable(grievanceLifecycle, [
    { name: 'submitted to the organization, the student waits for the Admin', record: { ...org, status: 'submitted' }, viewer: 'STUDENT', current: 'under_review', tone: 'waiting', title: 'Waiting for Admin to review', actorRole: 'ADMIN', to: undefined, states: { submitted: 'done', under_review: 'current', outcome: 'upcoming' } },
    { name: 'submitted to the SAO, the student waits for the SAO', record: { ...sao, status: 'submitted' }, viewer: 'STUDENT', current: 'under_review', tone: 'waiting', title: 'Waiting for SAO to review', actorRole: 'SUPER_ADMIN' },
    { name: 'submitted to the organization, the Admin reviews', record: { ...org, status: 'submitted' }, viewer: 'ADMIN', current: 'under_review', tone: 'action', title: 'Review this grievance', actorRole: 'ADMIN', label: 'Open grievance', to: '/dashboard/grievances?record=3' },
    { name: 'submitted to the SAO, the SAO reviews', record: { ...sao, status: 'submitted' }, viewer: 'SUPER_ADMIN', current: 'under_review', tone: 'action', title: 'Review this grievance', actorRole: 'SUPER_ADMIN', to: '/dashboard/super-admin/grievances?record=3' },
    { name: 'submitted to the SAO, the Admin only waits', record: { ...sao, status: 'submitted' }, viewer: 'ADMIN', current: 'under_review', tone: 'waiting', title: 'Waiting for SAO to review', actorRole: 'SUPER_ADMIN' },
    { name: 'under_review, the student', record: { ...org, status: 'under_review' }, viewer: 'STUDENT', current: 'under_review', tone: 'waiting', title: 'Under review by Admin', actorRole: 'ADMIN' },
    { name: 'under_review, the reviewer decides', record: { ...org, status: 'under_review' }, viewer: 'ADMIN', current: 'under_review', tone: 'action', title: 'Decide: resolve or dismiss', actorRole: 'ADMIN' },
    { name: 'resolved with remarks', record: { ...org, status: 'resolved', remarks: 'Fixed the schedule' }, viewer: 'STUDENT', current: null, tone: 'done', title: 'Resolved', actorRole: null, body: 'Fixed the schedule', states: { submitted: 'done', under_review: 'done', outcome: 'done' } },
    { name: 'dismissed', record: { ...org, status: 'dismissed' }, viewer: 'STUDENT', current: null, tone: 'done', title: 'Dismissed', actorRole: null, body: 'The grievance was dismissed.' },
  ]);

  it('names the last step after the outcome', () => {
    expect(grievanceLifecycle({ ...org, status: 'resolved' }, 'STUDENT').steps[2].label).toBe('Resolved');
    expect(grievanceLifecycle({ ...org, status: 'dismissed' }, 'STUDENT').steps[2].label).toBe('Dismissed');
    expect(grievanceLifecycle({ ...org, status: 'submitted' }, 'STUDENT').steps[2].label).toBe('Outcome');
  });

  it('sends a student to My grievances', () => {
    expect(grievanceLifecycle({ ...org, status: 'submitted' }, 'STUDENT').href).toBe('/dashboard/my-grievances?record=3');
  });
});

describe('venueBookingLifecycle', () => {
  runTable(venueBookingLifecycle, [
    { name: 'pending, the Admin waits', record: { id: 8, status: 'pending' }, viewer: 'ADMIN', current: 'review', tone: 'waiting', title: 'Waiting for SAO approval', actorRole: 'SUPER_ADMIN', states: { requested: 'done', review: 'current', approved: 'upcoming' } },
    { name: 'pending, the SAO reviews', record: { id: 8, status: 'pending' }, viewer: 'SUPER_ADMIN', current: 'review', tone: 'action', title: 'Review the booking', actorRole: 'SUPER_ADMIN', label: 'Review booking', to: '/dashboard/super-admin/venues?record=8' },
    { name: 'approved', record: { id: 8, status: 'approved' }, viewer: 'ADMIN', current: null, tone: 'done', title: 'Approved: venue booked', actorRole: null, states: { requested: 'done', review: 'done', approved: 'done' } },
    { name: 'rejected with remarks, the Admin books again', record: { id: 8, status: 'rejected', remarks: 'Room is closed' }, viewer: 'ADMIN', current: 'review', tone: 'action', title: 'Rejected: read the remarks and request again', actorRole: 'ADMIN', body: 'Room is closed', label: 'Book again', to: '/dashboard/venues', states: { requested: 'done', review: 'blocked', approved: 'upcoming' } },
    { name: 'rejected, the SAO sees it as settled', record: { id: 8, status: 'rejected' }, viewer: 'SUPER_ADMIN', current: 'review', tone: 'waiting', title: 'Rejected by the SAO', actorRole: 'ADMIN' },
    { name: 'withdrawn', record: { id: 8, status: 'withdrawn' }, viewer: 'ADMIN', current: null, tone: 'blocked', title: 'Withdrawn', actorRole: null, states: { requested: 'done', review: 'stopped', approved: 'skipped' } },
  ]);
});

describe('clearanceLifecycle', () => {
  const line = (required_role, status, remarks = null) => ({ required_role, status, remarks });

  it('shows one step per signatory with readable labels', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'cleared'), line('organization_treasurer', 'pending'), line('adviser', 'pending')] }, 'STUDENT');
    assertShape(result);
    expect(result.steps.map((step) => step.label)).toEqual(['SAO', 'Organization Treasurer', 'Adviser']);
    expect(result.steps.map((step) => step.state)).toEqual(['done', 'upcoming', 'upcoming']);
    expect(result.current).toBeNull();
  });

  it('pending, one signatory left, the student waits and the SAO is not mistaken for an Admin', () => {
    const result = clearanceLifecycle({ signatures: [line('adviser', 'cleared'), line('sao', 'pending')] }, 'STUDENT');
    assertShape(result);
    expect(result.nextAction).toEqual({ tone: 'waiting', title: 'Waiting for SAO signature', body: 'No action needed from you.' });
    expect(result.actorRole).toBe('SUPER_ADMIN');
    expect(result.href).toBe('/dashboard/my-clearance');
  });

  it('pending, several signatories left, names them all', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'pending'), line('adviser', 'pending')] }, 'STUDENT');
    expect(result.nextAction.title).toBe('Waiting for 2 signatures');
    expect(result.nextAction.body).toBe('SAO, Adviser. No action needed from you.');
    expect(result.actorRole).toBe('SUPER_ADMIN');
  });

  it('pending, an organization role belongs to the Admin', () => {
    const result = clearanceLifecycle({ signatures: [line('adviser', 'pending')] }, 'STUDENT');
    expect(result.actorRole).toBe('ADMIN');
  });

  it('pending, an Admin can sign an organization role', () => {
    const result = clearanceLifecycle({ signatures: [line('adviser', 'pending')] }, 'ADMIN');
    expect(result.nextAction).toMatchObject({ tone: 'action', title: 'Sign this clearance', label: 'Open clearance signing', to: '/dashboard/clearances' });
  });

  it('pending, an Admin cannot sign the SAO line and only waits', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'pending')] }, 'ADMIN');
    expect(result.nextAction.tone).toBe('waiting');
  });

  it('pending, the SAO signs the SAO line', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'pending')] }, 'SUPER_ADMIN');
    expect(result.nextAction).toMatchObject({ tone: 'action', to: '/dashboard/super-admin/clearances' });
  });

  it('held with a reason blocks the student and marks the step blocked', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'cleared'), line('adviser', 'held', 'Unpaid dues')] }, 'STUDENT');
    assertShape(result);
    expect(result.steps.map((step) => step.state)).toEqual(['done', 'blocked']);
    expect(result.current.key).toBe('adviser');
    expect(result.nextAction).toEqual({ tone: 'blocked', title: 'On hold: Unpaid dues', body: 'Fix the issue and ask the signatory to sign again.' });
  });

  it('held without a reason names the signatory', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'held')] }, 'STUDENT');
    expect(result.nextAction.title).toBe('On hold by SAO');
  });

  it('held, the signatory can clear it again', () => {
    const result = clearanceLifecycle({ signatures: [line('adviser', 'held', 'Unpaid dues')] }, 'SBO_OFFICER');
    expect(result.nextAction).toMatchObject({ tone: 'action', title: 'Sign this clearance' });
  });

  it('cleared on every line is complete', () => {
    const result = clearanceLifecycle({ signatures: [line('sao', 'cleared'), line('adviser', 'cleared')] }, 'STUDENT');
    assertShape(result);
    expect(result.steps.every((step) => step.state === 'done')).toBe(true);
    expect(result.nextAction).toEqual({ tone: 'done', title: 'You are cleared', body: 'Every signatory has cleared you.' });
    expect(result.actorRole).toBeNull();
  });
});

describe('records that ended without finishing', () => {
  const ended = [
    ['a cancelled order', orderLifecycle({ id: 1, status: 'cancelled' }, 'STUDENT'), 'Cancelled'],
    ['a cancelled event', eventLifecycle({ id: 1, status: 'cancelled' }, 'ADMIN'), 'Cancelled'],
    ['an archived organization', organizationRegistrationLifecycle({ id: 1, lifecycle_status: 'archived' }, 'SUPER_ADMIN'), 'Archived'],
    ['a withdrawn venue booking', venueBookingLifecycle({ id: 1, status: 'withdrawn' }, 'ADMIN'), 'Withdrawn'],
  ];

  it.each(ended)('shows exactly one stopped step for %s and no unfinished-looking skipped run', (_name, result, note) => {
    const stopped = result.steps.filter((step) => step.state === 'stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].note).toBe(note);
    expect(result.steps.some((step) => step.state === 'current')).toBe(false);
    expect(result.nextAction.tone).toBe('blocked');
  });
});
