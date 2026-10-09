import { manilaDate, peso } from './format';

// Pure functions that turn a server record into FlowStepper data and the next action. Every status
// string below was checked against the controllers and migrations (see docs/UX_FLOW.md section 4);
// where the spec and the code disagreed, the code won. Each function takes the record and, when the
// next action depends on who is looking, the viewer's role. A missing viewer role is treated as the
// person whose turn it is, so a page that does not know the role still gets a usable action.

export const ROLE_LABELS = {
  ADMIN: 'Admin',
  SBO_OFFICER: 'Officer',
  DEPARTMENT_HEAD: 'Department Head',
  SUPER_ADMIN: 'SAO',
  STUDENT: 'Student',
};

const NO_ACTION = 'No action needed from you.';
const APPROVAL_ROUTES = { DEPARTMENT_HEAD: '/dashboard/department-head/approvals', ADMIN: '/dashboard/approvals' };

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? null;
}

function humanize(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recordHref(base, id) {
  return id === undefined || id === null ? base : `${base}?record=${id}`;
}

function approvalsHref(role) {
  return APPROVAL_ROUTES[role] ?? null;
}

function buildSteps(defs, stage, { blocked = false, skipped = [], notes = {}, actors = {}, states = {} } = {}) {
  return defs.map((def, index) => {
    let state = 'upcoming';
    if (skipped.includes(def.key)) state = 'skipped';
    else if (index < stage) state = 'done';
    else if (index === stage) state = blocked ? 'blocked' : 'current';
    return { key: def.key, label: def.label, state: states[def.key] ?? state, actor: actors[def.key] ?? def.actor, note: notes[def.key] };
  });
}

function finish(steps, nextAction, actorRole, href) {
  const current = steps.find((step) => step.state === 'current') ?? steps.find((step) => step.state === 'blocked') ?? null;
  return { steps, current, nextAction, actorRole: actorRole ?? null, href: href ?? null };
}

function unknown(defs, status, href) {
  const nextAction = {
    tone: 'waiting',
    title: status ? `Status: ${humanize(status)}` : 'Status unavailable',
    body: 'This record is in a state that has no guided next step.',
  };
  return finish(buildSteps(defs, -1), nextAction, null, href);
}

function turn(viewerRole, actors, action, waiting) {
  if (!viewerRole || actors.includes(viewerRole)) return { tone: 'action', ...action };
  return { tone: 'waiting', title: waiting.title, body: waiting.body ?? NO_ACTION };
}

function terminal(tone, title, body, extra = {}) {
  return { tone, title, body, ...extra };
}

export function toNextStepProps(lifecycle) {
  const { nextAction, actorRole } = lifecycle;
  const { label, to } = nextAction;
  return {
    tone: nextAction.tone,
    title: nextAction.title,
    body: nextAction.body,
    actorRole: roleLabel(actorRole) ?? undefined,
    primary: label ? { label, to } : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Financial report. submission_status: draft, pending_department_head, pending_sao, approved, rejected.

const REPORT_STAGES = [
  { key: 'draft', label: 'Draft', actor: 'Admin' },
  { key: 'department_head', label: 'Department Head', actor: 'Department Head' },
  { key: 'sao', label: 'SAO', actor: 'SAO' },
  { key: 'approved', label: 'Approved' },
];

export function financialReportLifecycle(report, viewerRole) {
  const r = report ?? {};
  const href = recordHref('/dashboard/finance/transaction-history', r.id);
  const returned = (stage) => ({ blocked: true, notes: { [REPORT_STAGES[stage].key]: 'Returned' } });

  switch (r.submission_status) {
    case 'draft':
      return finish(buildSteps(REPORT_STAGES, 0), turn(viewerRole, ['ADMIN'], {
        title: 'Review and submit',
        body: 'Check the figures and signatories, then send the report to the Department Head.',
        label: 'Review report',
        to: href,
      }, { title: 'Waiting for the Admin to submit the report' }), 'ADMIN', href);
    case 'pending_department_head':
      return finish(buildSteps(REPORT_STAGES, 1), turn(viewerRole, ['DEPARTMENT_HEAD'], {
        title: 'Review this report',
        body: 'It is waiting for your decision.',
        label: 'Open approvals',
        to: approvalsHref('DEPARTMENT_HEAD'),
      }, { title: 'Waiting for Department Head approval' }), 'DEPARTMENT_HEAD', href);
    case 'pending_sao':
      return finish(buildSteps(REPORT_STAGES, 2), turn(viewerRole, ['SUPER_ADMIN'], {
        title: 'Review this report',
        body: 'The Department Head approved it. It is waiting for your decision.',
        label: 'Review report',
        to: '/dashboard/super-admin/compliance?tab=financial',
      }, { title: 'Waiting for SAO approval' }), 'SUPER_ADMIN', href);
    case 'approved':
      return finish(buildSteps(REPORT_STAGES, REPORT_STAGES.length), terminal('done', 'Approved', 'Both reviewers approved this report.'), null, href);
    case 'rejected': {
      const atSao = Boolean(r.department_head_approved_at);
      return finish(buildSteps(REPORT_STAGES, atSao ? 2 : 1, returned(atSao ? 2 : 1)), turn(viewerRole, ['ADMIN'], {
        title: 'Returned: fix and resubmit',
        body: r.approval_remarks || 'Read the reviewer remarks, fix the report, and submit it again.',
        label: 'Edit report',
        to: href,
      }, { title: 'Returned to the Admin for changes' }), 'ADMIN', href);
    }
    default:
      return unknown(REPORT_STAGES, r.submission_status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Budget. submission_status: pending_department_head, pending_sao (only when approvals.budget_final
// is SUPER_ADMIN), approved, rejected.

const BUDGET_STAGES = [
  { key: 'proposed', label: 'Proposed', actor: 'Department Head' },
  { key: 'second_review', label: 'Second review', actor: 'SAO' },
  { key: 'approved', label: 'Approved' },
  { key: 'spending', label: 'Spending', actor: 'Admin' },
  { key: 'reported', label: 'Reported', actor: 'Admin' },
];

export function budgetLifecycle(budget, viewerRole) {
  const b = budget ?? {};
  const href = recordHref('/dashboard/finance/budget-allocation', b.id);

  switch (b.submission_status) {
    case 'pending_department_head':
      return finish(buildSteps(BUDGET_STAGES, 0, { skipped: ['second_review'] }), turn(viewerRole, ['DEPARTMENT_HEAD'], {
        title: 'Review this budget',
        body: 'It is waiting for your decision.',
        label: 'Open approvals',
        to: approvalsHref('DEPARTMENT_HEAD'),
      }, { title: 'Waiting for Department Head approval' }), 'DEPARTMENT_HEAD', href);
    case 'pending_sao':
      return finish(buildSteps(BUDGET_STAGES, 1), turn(viewerRole, ['SUPER_ADMIN'], {
        title: 'Review this budget',
        body: 'The Department Head approved it. It is waiting for your decision.',
        label: 'Review budget',
        to: '/dashboard/super-admin/compliance?tab=financial',
      }, { title: 'Waiting for SAO approval' }), 'SUPER_ADMIN', href);
    case 'approved': {
      const spent = Number(b.spent_amount ?? 0);
      const allocated = Number(b.allocated_amount ?? 0);
      const body = spent > 0 && allocated > 0
        ? `${peso(spent)} of ${peso(allocated)} spent. Add it to the next financial report when the work is done.`
        : 'Record spending against it in the ledger, then add it to the next financial report.';
      return finish(buildSteps(BUDGET_STAGES, 3, { skipped: ['second_review'] }), turn(viewerRole, ['ADMIN'], {
        title: spent > 0 ? 'Approved: spending in progress' : 'Approved: record spending against it',
        body,
        label: 'Open ledger',
        to: '/dashboard/finance/financial-ledger',
      }, { title: 'Approved: the Admin records spending', body: NO_ACTION }), 'ADMIN', href);
    }
    case 'rejected': {
      const atSecond = Boolean(b.department_head_approved_at);
      return finish(buildSteps(BUDGET_STAGES, atSecond ? 1 : 0, { blocked: true, skipped: atSecond ? [] : ['second_review'], notes: { [atSecond ? 'second_review' : 'proposed']: 'Returned' } }), turn(viewerRole, ['ADMIN'], {
        title: 'Returned: edit and resubmit',
        body: b.approval_remarks || 'Read the reviewer remarks, change the budget, and submit it again.',
        label: 'Edit budget',
        to: href,
      }, { title: 'Returned to the Admin for changes' }), 'ADMIN', href);
    }
    default:
      return unknown(BUDGET_STAGES, b.submission_status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Event. status: planning, approved, ongoing, completed, cancelled. The approval row (approval_status:
// pending, approved, rejected) and its approver (approval_required_role) live beside it. A rejected
// approval leaves status at planning. Fields approval_id, approval_required_role, requirements_required
// and requirements_submitted arrive with the server change S2 and may be absent.

const EVENT_STAGES = [
  { key: 'proposal', label: 'Proposal', actor: 'Admin' },
  { key: 'requirements', label: 'Requirements', actor: 'Admin' },
  { key: 'approval', label: 'Approval' },
  { key: 'funding', label: 'Funding', actor: 'Admin' },
  { key: 'prepare', label: 'Prepare', actor: 'Admin, Officers' },
  { key: 'run', label: 'Run', actor: 'Admin, Officers' },
  { key: 'report', label: 'Report', actor: 'Admin' },
];

const EVENT_STATUSES = ['planning', 'approved', 'ongoing', 'completed', 'cancelled'];
const EVENT_MANAGERS = ['ADMIN', 'SBO_OFFICER'];

function fundingOf(budgets) {
  const find = (status) => budgets.find((budget) => budget.submission_status === status);
  const approved = find('approved');
  if (approved) return { state: 'approved', budget: approved };
  for (const state of ['pending_sao', 'pending_department_head', 'rejected']) {
    const budget = find(state);
    if (budget) return { state, budget };
  }
  return { state: 'none', budget: null };
}

function eventApprover(event) {
  if (event.approval_required_role) return event.approval_required_role;
  if (event.requirements_required === true) return 'SUPER_ADMIN';
  if (event.requirements_required === false) return 'DEPARTMENT_HEAD';
  return null;
}

function eventApprovalHref(approverRole, event) {
  if (approverRole === 'SUPER_ADMIN') return '/dashboard/super-admin/compliance?tab=events';
  const base = approvalsHref(approverRole);
  return base && event.approval_id ? `${base}?record=${event.approval_id}` : base;
}

export function eventLifecycle(event, viewerRole) {
  const e = event ?? {};
  const href = recordHref('/dashboard/events/manage-events', e.id);
  if (!EVENT_STATUSES.includes(e.status)) return unknown(EVENT_STAGES, e.status, href);

  if (e.status === 'cancelled') {
    const skipped = EVENT_STAGES.slice(1).map((stage) => stage.key);
    return finish(buildSteps(EVENT_STAGES, 1, { skipped }), terminal('blocked', 'Cancelled', 'This event was cancelled. Nothing more to do.'), null, href);
  }

  const approval = e.approval_status ?? null;
  const status = e.status === 'planning' && approval === 'approved' ? 'approved' : e.status;
  const approverRole = eventApprover(e);
  const approverLabel = roleLabel(approverRole);
  const requirementsRequired = e.requirements_required === true;
  const budgets = Array.isArray(e.budgets) ? e.budgets : [];
  const needsFunding = e.requires_budget === true || budgets.length > 0;
  const funding = fundingOf(budgets);
  const fundingDone = !needsFunding || funding.state === 'approved';
  const report = e.financial_report ? financialReportLifecycle(e.financial_report, viewerRole) : null;

  let stage;
  let blocked = false;
  if (status === 'planning') {
    if (approval === 'pending') stage = 2;
    else if (approval === 'rejected') [stage, blocked] = [2, true];
    else if (requirementsRequired && e.requirements_submitted !== true) stage = 1;
    else stage = 0;
  } else if (status === 'approved') {
    if (fundingDone) stage = 4;
    else [stage, blocked] = [3, funding.state === 'rejected'];
  } else if (status === 'ongoing') {
    stage = 5;
  } else if (report && report.steps.every((step) => step.state === 'done')) {
    stage = 7;
  } else {
    [stage, blocked] = [6, report?.current?.state === 'blocked'];
  }

  const skipped = [];
  if (!requirementsRequired) skipped.push('requirements');
  if (!needsFunding) skipped.push('funding');
  const notes = {};
  const states = {};
  if (stage > 3 && needsFunding && funding.state !== 'approved') states.funding = 'upcoming';
  if (approval === 'rejected' && stage === 2) notes.approval = 'Returned';
  if (stage === 3 && funding.state === 'pending_department_head') notes.funding = 'Waiting for Department Head';
  if (stage === 3 && funding.state === 'pending_sao') notes.funding = 'Waiting for SAO';
  if (stage === 3 && funding.state === 'rejected') notes.funding = 'Returned';
  const tasksTotal = Number(e.tasks_count ?? 0);
  const tasksDone = Number(e.completed_tasks_count ?? 0);
  if (stage === 4 && tasksTotal > 0) notes.prepare = `${tasksDone} of ${tasksTotal} tasks done`;
  const steps = buildSteps(EVENT_STAGES, stage, { blocked, skipped, notes, states, actors: { approval: approverLabel ?? 'Approver' } });
  if (stage === 6 && report) steps[6] = { ...steps[6], state: report.current?.state ?? steps[6].state, note: report.nextAction.title };

  const admin = (action, waitingTitle, waitingBody) => turn(viewerRole, ['ADMIN'], action, { title: waitingTitle, body: waitingBody });
  const managers = (action, waitingTitle) => turn(viewerRole, EVENT_MANAGERS, action, { title: waitingTitle });

  switch (stage) {
    case 0:
      return finish(steps, admin({
        title: 'Finish the proposal and submit it',
        body: 'The event has not been sent for approval yet.',
        label: 'Open the proposal',
        to: href,
      }, 'Waiting for the Admin to submit the proposal'), 'ADMIN', href);
    case 1:
      return finish(steps, admin({
        title: 'Submit the SAO event files',
        body: 'The SAO needs these files before it can approve the event.',
        label: 'Submit event files',
        to: href,
      }, 'Waiting for the Admin to submit the SAO event files'), 'ADMIN', href);
    case 2:
      if (blocked) {
        return finish(steps, admin({
          title: 'Returned: read the remarks, edit, resubmit',
          body: e.approval_remarks || 'Read the approver remarks, change the event, and send it again.',
          label: 'Edit and resubmit',
          to: href,
        }, 'Returned to the Admin for changes'), 'ADMIN', href);
      }
      if (!approverRole) {
        return finish(steps, terminal('waiting', 'Waiting for approval', NO_ACTION), null, href);
      }
      return finish(steps, turn(viewerRole, [approverRole], {
        title: 'Review this event',
        body: 'It is waiting for your decision.',
        label: 'Open approval',
        to: eventApprovalHref(approverRole, e),
      }, { title: `Waiting for ${approverLabel} approval` }), approverRole, href);
    case 3: {
      const budgetHref = recordHref('/dashboard/finance/budget-allocation', funding.budget?.id);
      if (funding.state === 'none') {
        return finish(steps, admin({
          title: 'Propose the event budget',
          body: 'This event needs funding. The Department Head approves the budget.',
          label: 'Propose budget',
          to: `/dashboard/finance/budget-allocation?event=${e.id}`,
        }, 'Waiting for the Admin to propose the event budget'), 'ADMIN', href);
      }
      if (funding.state === 'rejected') {
        return finish(steps, admin({
          title: 'Budget returned: edit and resubmit',
          body: funding.budget.approval_remarks || 'Read the reviewer remarks, change the budget, and send it again.',
          label: 'Edit budget',
          to: budgetHref,
        }, 'Budget returned to the Admin for changes'), 'ADMIN', href);
      }
      const reviewer = funding.state === 'pending_sao' ? 'SUPER_ADMIN' : 'DEPARTMENT_HEAD';
      return finish(steps, turn(viewerRole, [reviewer], {
        title: 'Review the event budget',
        body: 'It is waiting for your decision.',
        label: reviewer === 'SUPER_ADMIN' ? 'Review budget' : 'Open approvals',
        to: reviewer === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance?tab=financial' : approvalsHref(reviewer),
      }, { title: `Budget waiting for ${roleLabel(reviewer)} approval` }), reviewer, href);
    }
    case 4:
      if (tasksTotal === 0) {
        return finish(steps, managers({
          title: 'Plan the tasks',
          body: 'Book a venue if the event needs one, then split the work into tasks.',
          label: 'Plan tasks',
          to: `/dashboard/events/event-planner?event=${e.id}`,
        }, 'The organization is preparing this event'), 'ADMIN', href);
      }
      if (tasksDone < tasksTotal) {
        return finish(steps, managers({
          title: `${tasksDone} of ${tasksTotal} tasks done`,
          body: 'Finish the open tasks before the event starts.',
          label: 'Open tasks',
          to: viewerRole === 'SBO_OFFICER' ? '/dashboard/tasks/assigned-tasks' : `/dashboard/tasks/task-board?event=${e.id}`,
        }, 'The organization is preparing this event'), 'ADMIN', href);
      }
      return finish(steps, managers({
        title: 'Ready to run',
        body: `All ${tasksTotal} tasks are done. Mark the event ongoing when it starts.`,
        label: 'Open event',
        to: href,
      }, 'The organization is preparing this event'), 'ADMIN', href);
    case 5: {
      const present = e.present_count;
      return finish(steps, managers({
        title: 'Check people in',
        body: present === undefined || present === null ? 'The event is under way. Record attendance as people arrive.' : `${present} checked in so far.`,
        label: 'Open check-in',
        to: `/dashboard/events/check-in?event=${e.id}`,
      }, 'This event is happening now'), 'ADMIN', href);
    }
    case 6:
      if (report) return finish(steps, report.nextAction, report.actorRole, href);
      return finish(steps, admin({
        title: 'Prepare the event financial report',
        body: 'The event is complete. Generate its report and send it for approval.',
        label: 'Prepare report',
        to: `/dashboard/finance/transaction-history?event=${e.id}`,
      }, 'Waiting for the Admin to prepare the event report'), 'ADMIN', href);
    default:
      return finish(steps, terminal('done', 'Event complete', 'The event financial report is approved.'), null, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Election. status: pending_approval, upcoming, active, closed. finalized_at locks the ballot;
// results_visible releases the results. A rejected approval leaves status at pending_approval.

const ELECTION_STAGES = [
  { key: 'submitted', label: 'Submitted', actor: 'Department Head' },
  { key: 'ballot', label: 'Build ballot', actor: 'Admin' },
  { key: 'locked', label: 'Ballot locked', actor: 'Admin' },
  { key: 'voting', label: 'Voting', actor: 'Students' },
  { key: 'results', label: 'Results', actor: 'Admin' },
];

export function electionLifecycle(election, viewerRole) {
  const el = election ?? {};
  const href = recordHref('/dashboard/elections/manage-elections', el.id);

  switch (el.status) {
    case 'pending_approval':
      if (el.approval_status === 'rejected') {
        return finish(buildSteps(ELECTION_STAGES, 0, { blocked: true, notes: { submitted: 'Returned' } }), turn(viewerRole, ['ADMIN'], {
          title: 'Returned: edit and resubmit',
          body: el.approval_remarks || 'Read the reviewer remarks, change the election, and send it again.',
          label: 'Edit election',
          to: href,
        }, { title: 'Returned to the Admin for changes' }), 'ADMIN', href);
      }
      return finish(buildSteps(ELECTION_STAGES, 0), turn(viewerRole, ['DEPARTMENT_HEAD'], {
        title: 'Review this election',
        body: 'It is waiting for your decision.',
        label: 'Open approvals',
        to: approvalsHref('DEPARTMENT_HEAD'),
      }, { title: 'Awaiting Department Head review' }), 'DEPARTMENT_HEAD', href);
    case 'upcoming':
      if (!el.finalized_at) {
        return finish(buildSteps(ELECTION_STAGES, 1), turn(viewerRole, ['ADMIN', 'SBO_OFFICER'], {
          title: 'Build the ballot',
          body: 'Add party lists, then candidates for every position, then finalize.',
          label: 'Open ballot setup',
          to: viewerRole === 'SBO_OFFICER' ? '/dashboard/elections/manage-candidates' : href,
        }, { title: 'Waiting for the ballot to be built' }), 'ADMIN', href);
      }
      return finish(buildSteps(ELECTION_STAGES, 2), turn(viewerRole, ['ADMIN'], {
        title: 'Ballot locked: open voting when it starts',
        body: el.start_time ? `Voting is scheduled for ${manilaDate(el.start_time)}. Open it from the election page.` : 'Open voting from the election page when it starts.',
        label: 'Open election',
        to: href,
      }, { title: el.start_time ? `Ballot locked: voting opens on ${manilaDate(el.start_time)}` : 'Ballot locked: voting opens soon' }), 'ADMIN', href);
    case 'active': {
      const until = el.end_time ? ` until ${manilaDate(el.end_time)}` : '';
      const steps = buildSteps(ELECTION_STAGES, 3);
      if (viewerRole === 'STUDENT') {
        if (el.has_voted === true) {
          return finish(steps, terminal('done', 'You have voted', 'Results appear when voting closes.'), null, href);
        }
        return finish(steps, terminal('action', 'Cast your ballot', `Voting is open${until}.`, { label: 'Vote now', to: el.id === undefined ? undefined : `/elections/${el.id}/vote` }), 'STUDENT', href);
      }
      return finish(steps, terminal('waiting', `Voting is open${until}`, 'Students are voting. No action needed from you.'), 'STUDENT', href);
    }
    case 'closed':
      if (el.results_visible === false) {
        return finish(buildSteps(ELECTION_STAGES, 4), turn(viewerRole, ['ADMIN'], {
          title: 'Closed: release the results',
          body: 'Voting has ended. Results stay hidden until you release them.',
          label: 'Open election',
          to: href,
        }, { title: 'Closed: results not released yet' }), 'ADMIN', href);
      }
      return finish(buildSteps(ELECTION_STAGES, ELECTION_STAGES.length), terminal('done', 'Results released', 'Voting is closed and the results are public.', { label: 'View results', to: '/dashboard/elections/election-results' }), null, href);
    default:
      return unknown(ELECTION_STAGES, el.status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Merchandise order. status: pending, paid, claimed, cancelled (there is no payment_status column).
// A pending order with payment_proof_url is waiting for the payment check; the claim token is only
// returned by the server once the order is paid. Pass 'STUDENT' as the viewer on My orders, even for
// an Officer or Admin buying for themselves.

const ORDER_STAGES = [
  { key: 'reserved', label: 'Reserved', actor: 'Buyer' },
  { key: 'proof', label: 'Payment check', actor: 'Officer, Admin' },
  { key: 'paid', label: 'Paid', actor: 'Buyer' },
  { key: 'claimed', label: 'Claimed' },
];

const ORDER_STAFF = ['SBO_OFFICER', 'ADMIN'];

export function orderLifecycle(order, viewerRole) {
  const o = order ?? {};
  const isBuyer = !viewerRole || viewerRole === 'STUDENT';
  const href = isBuyer ? recordHref('/dashboard/merchandise/my-orders', o.id) : recordHref('/dashboard/merchandise/manage-orders', o.id);

  switch (o.status) {
    case 'pending':
      if (o.payment_proof_url) {
        return finish(buildSteps(ORDER_STAGES, 1), turn(viewerRole ?? 'STUDENT', ORDER_STAFF, {
          title: 'Verify the payment',
          body: 'The buyer submitted proof of payment. Check it and release the order.',
          label: 'Review order',
          to: href,
        }, { title: 'Waiting for payment check', body: 'An officer or administrator is checking your payment.' }), 'SBO_OFFICER', href);
      }
      return finish(buildSteps(ORDER_STAGES, 0), turn(viewerRole, ['STUDENT'], {
        title: 'Pay cash at pickup, or submit GCash proof',
        body: 'Your items are reserved. The order is confirmed once the payment is checked.',
        label: 'Open order',
        to: href,
      }, { title: 'Waiting for the buyer to pay' }), 'STUDENT', href);
    case 'paid':
      if (isBuyer) {
        return finish(buildSteps(ORDER_STAGES, 2), terminal('action', o.claim_token ? `Show token ${o.claim_token} at the claim desk` : 'Show your claim token at the claim desk', 'Payment is confirmed. Collect your items from the claim desk.'), 'STUDENT', href);
      }
      return finish(buildSteps(ORDER_STAGES, 2), turn(viewerRole, ORDER_STAFF, {
        title: 'Release at the claim desk',
        body: 'Payment is confirmed. Hand over the items when the buyer shows the token.',
        label: 'Open claim desk',
        to: '/dashboard/merchandise/claim-tokens',
      }, { title: 'Waiting for the buyer to collect' }), 'STUDENT', href);
    case 'claimed':
      return finish(buildSteps(ORDER_STAGES, ORDER_STAGES.length), terminal('done', o.claimed_at ? `Collected on ${manilaDate(o.claimed_at)}` : 'Collected', 'The items were handed over.'), null, href);
    case 'cancelled':
      return finish(buildSteps(ORDER_STAGES, 1, { skipped: ['proof', 'paid', 'claimed'] }), terminal('blocked', 'Cancelled', o.review_remarks ? `Cancelled: ${o.review_remarks}` : 'This order was cancelled.'), null, href);
    default:
      return unknown(ORDER_STAGES, o.status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Organization registration. lifecycle_status: pending, returned, active, archived. After approval
// the SAO must provision an administrator (administrators_count). setup_steps_done and
// setup_steps_total are optional and describe the Admin first-use checklist.

const REGISTRATION_STAGES = [
  { key: 'registered', label: 'Registered', actor: 'Department Head' },
  { key: 'review', label: 'SAO review', actor: 'SAO' },
  { key: 'administrator', label: 'Administrator', actor: 'SAO' },
  { key: 'first_use', label: 'First use', actor: 'Admin' },
];

export function organizationRegistrationLifecycle(organization, viewerRole) {
  const o = organization ?? {};
  const saoHref = o.id === undefined ? '/dashboard/super-admin/organizations'
    : o.lifecycle_status === 'pending' ? `/dashboard/super-admin/organizations?status=pending&review=${o.id}`
      : `/dashboard/super-admin/organizations/${o.id}`;
  const href = viewerRole === 'SUPER_ADMIN' ? saoHref : recordHref('/dashboard/department-head/organizations', o.id);

  switch (o.lifecycle_status) {
    case 'pending':
      return finish(buildSteps(REGISTRATION_STAGES, 1), turn(viewerRole, ['SUPER_ADMIN'], {
        title: 'Review the registration',
        body: 'The Department Head registered this organization. Approve it or return it with remarks.',
        label: 'Review registration',
        to: saoHref,
      }, { title: 'Waiting for SAO review' }), 'SUPER_ADMIN', href);
    case 'returned':
      return finish(buildSteps(REGISTRATION_STAGES, 1, { blocked: true, notes: { review: 'Returned' } }), turn(viewerRole, ['DEPARTMENT_HEAD'], {
        title: 'Returned: edit and resubmit',
        body: o.review_remarks || 'Read the SAO remarks, fix the registration, and submit it again.',
        label: 'Edit and resubmit',
        to: o.id === undefined ? '/dashboard/department-head/organizations?status=returned' : `/dashboard/department-head/organizations?status=returned&record=${o.id}`,
      }, { title: 'Waiting for the Department Head to resubmit' }), 'DEPARTMENT_HEAD', href);
    case 'active': {
      if (o.administrators_count === undefined || o.administrators_count === null) {
        return finish(buildSteps(REGISTRATION_STAGES, 2), terminal('done', 'Approved and active', 'The SAO approved this registration.'), null, href);
      }
      if (Number(o.administrators_count) === 0) {
        return finish(buildSteps(REGISTRATION_STAGES, 2), turn(viewerRole, ['SUPER_ADMIN'], {
          title: 'Provision an administrator',
          body: 'Approved. The organization cannot sign in until it has an administrator.',
          label: 'Create administrator',
          to: o.id === undefined ? '/dashboard/super-admin/admins' : `/dashboard/super-admin/admins?organization=${o.id}&create=1`,
        }, { title: 'Approved: waiting for the SAO to assign an administrator' }), 'SUPER_ADMIN', href);
      }
      const total = Number(o.setup_steps_total ?? 0);
      const left = total - Number(o.setup_steps_done ?? 0);
      if (total > 0 && left > 0) {
        return finish(buildSteps(REGISTRATION_STAGES, 3, { notes: { first_use: `${left} of ${total} steps left` } }), turn(viewerRole, ['ADMIN'], {
          title: `Finish your ${left} setup ${left === 1 ? 'step' : 'steps'}`,
          body: 'Add positions, members and a first event so the organization can start working.',
          label: 'Open dashboard',
          to: '/dashboard/admin',
        }, { title: 'The administrator is finishing setup' }), 'ADMIN', href);
      }
      return finish(buildSteps(REGISTRATION_STAGES, REGISTRATION_STAGES.length), terminal('done', 'Administrator can sign in', 'The organization is set up and active.'), null, href);
    }
    case 'archived':
      return finish(buildSteps(REGISTRATION_STAGES, 2, { skipped: ['administrator', 'first_use'] }), terminal('blocked', 'Archived: read only', 'The SAO can restore it from the organization page.'), null, href);
    default:
      return unknown(REGISTRATION_STAGES, o.lifecycle_status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Compliance renewal, one requirement for one academic year. status: not_submitted (derived, there is
// no row yet), submitted, approved, returned. Fields as in the compliance breakdown payload:
// requirement_name, deadline_at, remarks.

const COMPLIANCE_STAGES = [
  { key: 'required', label: 'Required', actor: 'Admin' },
  { key: 'submitted', label: 'Submitted', actor: 'SAO' },
  { key: 'approved', label: 'Approved' },
];

export function complianceRenewalLifecycle(submission, viewerRole) {
  const s = submission ?? {};
  const href = '/dashboard/compliance';
  const name = s.requirement_name ?? 'the requirement';

  switch (s.status) {
    case 'not_submitted':
      return finish(buildSteps(COMPLIANCE_STAGES, 0), turn(viewerRole, ['ADMIN'], {
        title: s.deadline_at ? `Submit ${name} by ${manilaDate(s.deadline_at)}` : `Submit ${name}`,
        body: 'Upload the file from the Compliance page.',
        label: 'Open compliance',
        to: href,
      }, { title: 'Waiting for the Admin to submit' }), 'ADMIN', href);
    case 'submitted':
      return finish(buildSteps(COMPLIANCE_STAGES, 1), turn(viewerRole, ['SUPER_ADMIN'], {
        title: 'Review the submission',
        body: `${humanize(name)} is waiting for your decision.`,
        label: 'Open review queue',
        to: '/dashboard/super-admin/compliance?tab=review',
      }, { title: 'Waiting for SAO review' }), 'SUPER_ADMIN', href);
    case 'approved':
      return finish(buildSteps(COMPLIANCE_STAGES, COMPLIANCE_STAGES.length), terminal('done', 'Approved', 'The SAO approved this requirement.'), null, href);
    case 'returned':
      return finish(buildSteps(COMPLIANCE_STAGES, 1, { blocked: true, notes: { submitted: 'Returned' } }), turn(viewerRole, ['ADMIN'], {
        title: 'Returned: replace the file',
        body: s.remarks || 'Read the SAO remarks, then upload a corrected file.',
        label: 'Open compliance',
        to: href,
      }, { title: 'Returned to the Admin for a new file' }), 'ADMIN', href);
    default:
      return unknown(COMPLIANCE_STAGES, s.status, href);
  }
}

// Accreditation roll-up across all requirements of one organization. status: incomplete, returned,
// pending_review, accredited, not_applicable (no requirements published). counts are optional.
const ACCREDITATION_STAGES = [
  { key: 'requirements', label: 'Requirements', actor: 'Admin' },
  { key: 'review', label: 'SAO review', actor: 'SAO' },
  { key: 'accredited', label: 'Accredited' },
];

export function accreditationLifecycle(summary, viewerRole) {
  const s = summary ?? {};
  const href = '/dashboard/compliance';
  const counts = Number(s.total) > 0 ? `${Number(s.approved ?? 0)} of ${Number(s.total)} requirements approved` : null;

  switch (s.status) {
    case 'incomplete':
      return finish(buildSteps(ACCREDITATION_STAGES, 0), turn(viewerRole, ['ADMIN'], {
        title: 'Submit the missing requirements',
        body: counts ?? 'Some requirements have not been submitted yet.',
        label: 'Open compliance',
        to: href,
      }, { title: 'Waiting for the Admin to submit requirements' }), 'ADMIN', href);
    case 'returned':
      return finish(buildSteps(ACCREDITATION_STAGES, 0, { blocked: true, notes: { requirements: 'Returned' } }), turn(viewerRole, ['ADMIN'], {
        title: 'Replace the returned files',
        body: counts ?? 'The SAO returned at least one requirement.',
        label: 'Open compliance',
        to: href,
      }, { title: 'Returned to the Admin for new files' }), 'ADMIN', href);
    case 'pending_review':
      return finish(buildSteps(ACCREDITATION_STAGES, 1), turn(viewerRole, ['SUPER_ADMIN'], {
        title: 'Review the submissions',
        body: counts ?? 'Submissions are waiting for your decision.',
        label: 'Open review queue',
        to: '/dashboard/super-admin/compliance?tab=review',
      }, { title: 'Waiting for SAO review' }), 'SUPER_ADMIN', href);
    case 'accredited':
      return finish(buildSteps(ACCREDITATION_STAGES, ACCREDITATION_STAGES.length), terminal('done', 'Accredited', counts ?? 'Every requirement is approved.'), null, href);
    case 'not_applicable':
      return finish(buildSteps(ACCREDITATION_STAGES, -1, { skipped: ACCREDITATION_STAGES.map((stage) => stage.key) }), terminal('done', 'No requirements this year', 'The SAO has not published any requirements yet.'), null, href);
    default:
      return unknown(ACCREDITATION_STAGES, s.status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Task. status: pending, in_progress, completed, overdue (set by tasks:mark-overdue; an overdue task
// can still move to in_progress or completed, and the server does not record whether it was ever
// started, so To do is not marked done). The page binds the action label to its own handler,
// so the pending and in-progress actions carry no route.

const TASK_STAGES = [
  { key: 'todo', label: 'To do', actor: 'Officer' },
  { key: 'in_progress', label: 'In progress', actor: 'Officer' },
  { key: 'done', label: 'Done' },
];

export function taskLifecycle(task, viewerRole) {
  const t = task ?? {};
  const href = viewerRole === 'SBO_OFFICER' ? recordHref('/dashboard/tasks/assigned-tasks', t.id) : recordHref('/dashboard/tasks/task-board', t.id);
  const waiting = { title: 'Waiting for the assigned officer' };

  switch (t.status) {
    case 'pending':
      return finish(buildSteps(TASK_STAGES, 0), turn(viewerRole, ['SBO_OFFICER'], { title: 'Start this task', body: 'Move it to in progress when you begin.', label: 'Start task' }, waiting), 'SBO_OFFICER', href);
    case 'in_progress':
      return finish(buildSteps(TASK_STAGES, 1), turn(viewerRole, ['SBO_OFFICER'], { title: 'Mark it done when finished', body: 'Update the progress as you go.', label: 'Mark done' }, waiting), 'SBO_OFFICER', href);
    case 'completed':
      return finish(buildSteps(TASK_STAGES, TASK_STAGES.length), terminal('done', 'Completed', 'This task is finished.'), null, href);
    case 'overdue':
      return finish(buildSteps(TASK_STAGES, 1, { blocked: true, notes: { in_progress: 'Overdue' }, states: { todo: 'upcoming' } }), turn(viewerRole, ['SBO_OFFICER'], {
        title: t.deadline ? `Overdue since ${manilaDate(t.deadline)}` : 'Overdue',
        body: 'The deadline has passed. Finish it or update its status.',
        label: 'Update status',
      }, { title: t.deadline ? `Overdue since ${manilaDate(t.deadline)}` : 'Overdue', body: 'Waiting for the assigned officer.' }), 'SBO_OFFICER', href);
    default:
      return unknown(TASK_STAGES, t.status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Grievance. status: submitted, under_review, resolved, dismissed (a submitted grievance can be closed
// without passing through under_review). addressed_to: organization (reviewed by the Admin) or sao.

function grievanceStages(outcome) {
  return [
    { key: 'submitted', label: 'Submitted', actor: 'Student' },
    { key: 'under_review', label: 'Under review' },
    { key: 'outcome', label: outcome },
  ];
}

export function grievanceLifecycle(grievance, viewerRole) {
  const g = grievance ?? {};
  const reviewerRole = g.addressed_to === 'sao' ? 'SUPER_ADMIN' : 'ADMIN';
  const reviewer = roleLabel(reviewerRole);
  const base = reviewerRole === 'SUPER_ADMIN' ? '/dashboard/super-admin/grievances' : '/dashboard/grievances';
  const href = viewerRole === 'STUDENT' ? recordHref('/dashboard/my-grievances', g.id) : recordHref(base, g.id);
  const stages = (outcome = 'Outcome') => grievanceStages(outcome).map((stage) => (stage.key === 'under_review' ? { ...stage, actor: reviewer } : stage));

  switch (g.status) {
    case 'submitted':
      return finish(buildSteps(stages(), 1, { notes: { under_review: 'Not picked up yet' } }), turn(viewerRole, [reviewerRole], {
        title: 'Review this grievance',
        body: 'Mark it under review, then resolve or dismiss it with remarks.',
        label: 'Open grievance',
        to: href,
      }, { title: `Waiting for ${reviewer} to review` }), reviewerRole, href);
    case 'under_review':
      return finish(buildSteps(stages(), 1, { notes: { under_review: 'Being reviewed' } }), turn(viewerRole, [reviewerRole], {
        title: 'Decide: resolve or dismiss',
        body: 'Add remarks the student will see.',
        label: 'Open grievance',
        to: href,
      }, { title: `Under review by ${reviewer}` }), reviewerRole, href);
    case 'resolved':
      return finish(buildSteps(stages('Resolved'), 3), terminal('done', 'Resolved', g.remarks || 'The grievance was resolved.'), null, href);
    case 'dismissed':
      return finish(buildSteps(stages('Dismissed'), 3), terminal('done', 'Dismissed', g.remarks || 'The grievance was dismissed.'), null, href);
    default:
      return unknown(stages(), g.status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Venue booking. status: pending, approved, rejected, withdrawn (by the requesting organization).

const VENUE_STAGES = [
  { key: 'requested', label: 'Requested', actor: 'Admin' },
  { key: 'review', label: 'SAO review', actor: 'SAO' },
  { key: 'approved', label: 'Approved' },
];

export function venueBookingLifecycle(booking, viewerRole) {
  const b = booking ?? {};
  const href = viewerRole === 'SUPER_ADMIN' ? recordHref('/dashboard/super-admin/venues', b.id) : recordHref('/dashboard/venues', b.id);

  switch (b.status) {
    case 'pending':
      return finish(buildSteps(VENUE_STAGES, 1), turn(viewerRole, ['SUPER_ADMIN'], {
        title: 'Review the booking',
        body: 'Approve it or return it with remarks.',
        label: 'Review booking',
        to: href,
      }, { title: 'Waiting for SAO approval' }), 'SUPER_ADMIN', href);
    case 'approved':
      return finish(buildSteps(VENUE_STAGES, VENUE_STAGES.length), terminal('done', 'Approved: venue booked', 'The venue is reserved for the requested time.'), null, href);
    case 'rejected':
      return finish(buildSteps(VENUE_STAGES, 1, { blocked: true, notes: { review: 'Rejected' } }), turn(viewerRole, ['ADMIN', 'SBO_OFFICER'], {
        title: 'Rejected: read the remarks and request again',
        body: b.remarks || 'Read the SAO remarks, adjust the request, and book again.',
        label: 'Book again',
        to: '/dashboard/venues',
      }, { title: 'Rejected by the SAO' }), 'ADMIN', href);
    case 'withdrawn':
      return finish(buildSteps(VENUE_STAGES, 1, { skipped: ['review', 'approved'] }), terminal('blocked', 'Withdrawn', 'The organization withdrew this booking request.'), null, href);
    default:
      return unknown(VENUE_STAGES, b.status, href);
  }
}

// ---------------------------------------------------------------------------------------------
// Clearance for one student and one period, shaped like GET /clearances/mine: signatures is a list
// of { required_role, status, remarks } with status pending, cleared or held. required_role is free
// text chosen by the SAO ('sao', 'adviser', ...); 'sao' is signed by SUPER_ADMIN and every other role
// by an Admin or Officer of the student's organization. Signatures can be given in any order, so
// pending lines are upcoming rather than current.

const SIGNATURE_STATUSES = ['pending', 'cleared', 'held'];

function signatoryLabel(role) {
  return role === 'sao' ? 'SAO' : humanize(role);
}

export function clearanceLifecycle(clearance, viewerRole) {
  const c = clearance ?? {};
  const signatures = Array.isArray(c.signatures) ? c.signatures : [];
  const defs = signatures.length === 0 ? [{ key: 'signatures', label: 'Signatures' }] : signatures.map((signature) => ({ key: String(signature.required_role), label: signatoryLabel(signature.required_role), actor: signature.required_role === 'sao' ? 'SAO' : 'Admin, Officer' }));
  const href = viewerRole === 'STUDENT' || !viewerRole ? '/dashboard/my-clearance' : viewerRole === 'SUPER_ADMIN' ? '/dashboard/super-admin/clearances' : '/dashboard/clearances';

  if (signatures.length === 0 || signatures.some((signature) => !SIGNATURE_STATUSES.includes(signature.status))) {
    return unknown(defs, signatures.length === 0 ? '' : 'unknown', href);
  }

  const states = { cleared: 'done', held: 'blocked', pending: 'upcoming' };
  const steps = signatures.map((signature, index) => ({
    key: defs[index].key,
    label: defs[index].label,
    state: states[signature.status],
    actor: defs[index].actor,
    note: signature.status === 'pending' ? 'Waiting' : signature.status === 'held' ? 'On hold' : undefined,
  }));

  const held = signatures.filter((signature) => signature.status === 'held');
  const pending = signatures.filter((signature) => signature.status === 'pending');
  if (held.length === 0 && pending.length === 0) {
    return finish(steps, terminal('done', 'You are cleared', 'Every signatory has cleared you.'), null, href);
  }

  const open = [...held, ...pending];
  const signerFor = (signature) => (signature.required_role === 'sao' ? ['SUPER_ADMIN'] : ['ADMIN', 'SBO_OFFICER']);
  const first = open[0];
  const actorRole = signerFor(first)[0];
  const canSign = Boolean(viewerRole) && viewerRole !== 'STUDENT' && open.some((signature) => signerFor(signature).includes(viewerRole));

  if (canSign) {
    return finish(steps, { tone: 'action', title: 'Sign this clearance', body: 'The student is waiting for your signature.', label: 'Open clearance signing', to: href }, actorRole, href);
  }
  if (held.length > 0) {
    const reason = held[0].remarks ? `On hold: ${held[0].remarks}` : `On hold by ${signatoryLabel(held[0].required_role)}`;
    return finish(steps, terminal('blocked', reason, 'Fix the issue and ask the signatory to sign again.'), actorRole, href);
  }
  const names = pending.map((signature) => signatoryLabel(signature.required_role));
  const title = names.length === 1 ? `Waiting for ${names[0]} signature` : `Waiting for ${names.length} signatures`;
  return finish(steps, terminal('waiting', title, names.length === 1 ? NO_ACTION : `${names.join(', ')}. ${NO_ACTION}`), actorRole, href);
}
