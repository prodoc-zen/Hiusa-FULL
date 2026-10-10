import { budgetLifecycle, electionLifecycle, eventLifecycle, financialReportLifecycle, roleLabel } from '../../lib/lifecycle';

export const ENTITY_LABEL = {
  event: 'Event',
  budget: 'Budget',
  election: 'Election',
  announcement: 'Announcement',
  payment: 'Payment',
  financial_report: 'Financial Report',
};

// The approval list rows carry a small summary of their record, not the record. These builders
// rebuild the fields each lifecycle function reads from the approval row and that summary, so a row
// says the same thing the entity's own page says for the same data. Where the server summary has
// the real field (pass-through below), it wins over what is derived from the approval row.
const EVENT_EXTRAS = ['approval_stage', 'requirements_required', 'requirements_submitted', 'requires_budget', 'budgets', 'tasks_count', 'completed_tasks_count', 'present_count', 'financial_report'];

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function eventRecord(request) {
  const summary = request.summary ?? {};
  const files = Array.isArray(summary.requirement_files) ? summary.requirement_files.length : 0;
  const base = { id: request.entity_id, status: summary.status, approval_id: request.id, approval_remarks: request.remarks, ...pick(summary, EVENT_EXTRAS) };

  // The Department Head approved but the event is still in planning: the SAO chain is next, or the
  // organization still owes the SAO files.
  if (summary.status === 'planning' && request.status === 'approved' && request.required_role === 'DEPARTMENT_HEAD') {
    return files > 0
      ? { ...base, approval_status: 'pending', approval_required_role: 'SUPER_ADMIN', requirements_required: true, requirements_submitted: true }
      : { ...base, approval_status: null, requirements_required: true, requirements_submitted: false };
  }

  return { ...base, approval_status: request.status, approval_required_role: request.required_role };
}

function pendingBudgetStatus(request) {
  return request.required_role === 'SUPER_ADMIN' ? 'pending_sao' : 'pending_department_head';
}

function budgetRecord(request) {
  const summary = request.summary ?? {};
  const derived = request.status === 'pending' ? pendingBudgetStatus(request) : request.status === 'approved' ? 'approved' : 'rejected';

  return {
    id: request.entity_id,
    submission_status: summary.submission_status ?? derived,
    approval_remarks: request.remarks,
    allocated_amount: summary.allocated_amount,
    spent_amount: summary.spent_amount,
    department_head_approved_at: summary.department_head_approved_at ?? (request.status === 'rejected' && request.required_role === 'SUPER_ADMIN' ? request.requested_at : null),
  };
}

function electionRecord(request) {
  const summary = request.summary ?? {};
  const decided = request.status === 'approved';

  return {
    id: request.entity_id,
    status: decided ? summary.target_status ?? 'upcoming' : 'pending_approval',
    approval_status: request.status,
    approval_remarks: request.remarks,
    finalized_at: summary.finalized_at,
    start_time: summary.start_time,
    end_time: summary.end_time,
    results_visible: summary.results_visible,
  };
}

function financialReportRecord(request) {
  const summary = request.summary ?? {};
  const derived = request.status === 'pending' ? (request.required_role === 'SUPER_ADMIN' ? 'pending_sao' : 'pending_department_head') : request.status === 'approved' ? 'approved' : 'rejected';

  return {
    id: request.entity_id,
    submission_status: summary.submission_status ?? derived,
    approval_remarks: request.remarks,
    department_head_approved_at: request.status === 'rejected' && request.required_role === 'SUPER_ADMIN' ? request.requested_at : null,
  };
}

const LIFECYCLES = {
  event: { record: eventRecord, lifecycle: eventLifecycle, pendingOwner: (record) => (record.approval_status === 'pending' ? record.approval_required_role : null) },
  budget: { record: budgetRecord, lifecycle: budgetLifecycle, pendingOwner: (record) => ({ pending_department_head: 'DEPARTMENT_HEAD', pending_sao: 'SUPER_ADMIN' })[record.submission_status] ?? null },
  election: { record: electionRecord, lifecycle: electionLifecycle, pendingOwner: (record) => (record.status === 'pending_approval' && record.approval_status === 'pending' ? 'DEPARTMENT_HEAD' : null) },
  financial_report: { record: financialReportRecord, lifecycle: financialReportLifecycle, pendingOwner: (record) => ({ pending_department_head: 'DEPARTMENT_HEAD', pending_sao: 'SUPER_ADMIN' })[record.submission_status] ?? null },
};

const CHIP_TONE = { pending: 'warning', approved: 'success', rejected: 'danger' };

function chipStage(request, viewerRole) {
  const owner = request.required_role;
  if (request.status === 'pending') {
    return {
      kind: 'chip',
      stageText: owner === viewerRole ? 'Waiting for your decision' : `Waiting for ${roleLabel(owner) ?? 'a reviewer'} approval`,
      tone: CHIP_TONE.pending,
    };
  }

  return {
    kind: 'chip',
    stageText: request.status === 'approved' ? 'Approved' : 'Rejected',
    tone: CHIP_TONE[request.status] ?? 'neutral',
  };
}

// What a row and the drawer say about where a request stands. Events, budgets, financial reports and
// elections come from their lifecycle function (steps, next action, owner). Announcements and
// payments have no lifecycle, so they get a status chip with the same wording style.
export function describeApproval(request, viewerRole) {
  const entry = LIFECYCLES[request.entity_type];
  if (!entry) return chipStage(request, viewerRole);

  const record = entry.record(request);
  const lifecycle = entry.lifecycle(record, viewerRole);
  const owner = entry.pendingOwner(record);
  const ownerLabel = owner && owner !== viewerRole ? roleLabel(owner) : null;
  const stageText = lifecycle.nextAction.title;

  return {
    kind: 'lifecycle',
    lifecycle,
    steps: lifecycle.steps,
    stageText,
    // Only said separately when the stage text itself does not name the owner.
    waitingOn: ownerLabel && !stageText.includes(ownerLabel) ? ownerLabel : null,
  };
}

// The sentence shown once a request is decided. For an event the Department Head approved while the
// SAO still has to clear it, the sentence says so; it is the same sentence on a fresh load.
export function decisionMessage(request) {
  if (request.status === 'pending') return null;

  if (request.status === 'rejected') return 'Rejected. Returned to the organization for changes';

  const summary = request.summary ?? {};
  const headApprovedEvent = request.entity_type === 'event' && request.required_role === 'DEPARTMENT_HEAD' && summary.status === 'planning';
  if (!headApprovedEvent) return 'Approved';

  const files = Array.isArray(summary.requirement_files) ? summary.requirement_files.length : 0;
  return files > 0
    ? 'Approved. Now with the SAO for requirements review'
    : 'Approved. Waiting for the organization to submit the SAO event files';
}

const OPEN_LABEL = { event: 'Open event', budget: 'Open budget', election: 'Open election', financial_report: 'Open report' };

// Every path here is in the role's list in server/config/client_routes.php. A role that cannot open
// an entity's page gets no entry for it, so no row ever links to a route the role is bounced from.
const calendar = (id) => `/dashboard/events/activity-calendar?record=${id}`;
const budgets = (id) => `/dashboard/finance/budget-allocation?record=${id}`;
const reports = (id) => `/dashboard/finance/transaction-history?record=${id}`;
const results = () => '/dashboard/elections/election-results';

const ENTITY_LINKS = {
  ADMIN: {
    event: (id) => `/dashboard/events/manage-events?record=${id}`,
    budget: budgets,
    financial_report: reports,
    election: (id) => `/dashboard/elections/manage-elections?record=${id}`,
  },
  DEPARTMENT_HEAD: { event: calendar, budget: budgets, financial_report: reports, election: results },
  SBO_OFFICER: { event: calendar, budget: budgets, financial_report: reports, election: results },
};

export function entityLink(request, role) {
  const build = ENTITY_LINKS[role]?.[request.entity_type];
  if (!build || !request.summary || request.entity_id === undefined || request.entity_id === null) return null;

  return { label: OPEN_LABEL[request.entity_type], to: build(request.entity_id) };
}
