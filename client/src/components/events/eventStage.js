import { eventLifecycle, roleLabel } from '../../lib/lifecycle';

// The server's approval_stage is the source of truth for the approval chain. eventLifecycle reads
// approval_status and approval_required_role instead, and cannot tell "the head approved, files are
// still missing" from "approved", so this adapter feeds it the fields it understands and then puts
// the two approval steps in the order the chain runs: the Department Head first, then the SAO files.

const STAGE_INPUT = {
  not_submitted: (event) => ({ approval_status: null, approval_required_role: null, requirements_submitted: event.requirements_required === true }),
  awaiting_department_head: () => ({ approval_status: 'pending', approval_required_role: 'DEPARTMENT_HEAD' }),
  awaiting_requirements: () => ({ approval_status: null, approval_required_role: null, requirements_required: true, requirements_submitted: false }),
  awaiting_sao: () => ({ approval_status: 'pending', approval_required_role: 'SUPER_ADMIN', requirements_required: true }),
  requirements_returned: () => ({ approval_status: null, approval_required_role: null, requirements_required: true, requirements_submitted: false }),
  approved: () => ({ approval_status: 'approved', approval_required_role: null }),
  rejected: () => ({ approval_status: 'rejected', approval_required_role: null }),
};

const STEP_STATES = {
  awaiting_department_head: { requirements: 'upcoming' },
  awaiting_requirements: { approval: 'done', requirements: 'current' },
  awaiting_sao: { approval: 'done', requirements: 'current' },
  requirements_returned: { approval: 'done', requirements: 'blocked' },
  rejected: { requirements: 'upcoming' },
};

const STEP_NOTES = {
  awaiting_sao: { requirements: 'Waiting for SAO' },
  requirements_returned: { requirements: 'Returned' },
  rejected: { approval: 'Returned' },
};

const STAGE_TEXT = {
  not_submitted: 'Not submitted',
  awaiting_department_head: 'Waiting for Department Head',
  awaiting_requirements: 'SAO files needed',
  awaiting_sao: 'Waiting for SAO',
  requirements_returned: 'Returned by SAO',
  rejected: 'Returned by Department Head',
  approved: 'Approved',
};

export const RETURNED_STAGES = ['rejected', 'requirements_returned'];
export const FILE_STAGES = ['awaiting_department_head', 'awaiting_requirements', 'awaiting_sao', 'requirements_returned'];

export function stageText(event) {
  return STAGE_TEXT[event?.approval_stage] ?? null;
}

function stepFor(steps, key, patch) {
  return steps.map((step) => (step.key === key ? { ...step, ...patch } : step));
}

function orderSteps(steps, stage, requirementsRequired) {
  const byKey = Object.fromEntries(steps.map((step) => [step.key, step]));
  const states = STEP_STATES[stage] ?? {};
  const notes = STEP_NOTES[stage] ?? {};
  let ordered = [
    { ...byKey.proposal, actor: 'Admin' },
    { ...byKey.approval, label: 'Department Head approval', actor: undefined },
    { ...byKey.requirements, label: 'SAO files', actor: 'Admin, SAO' },
    ...steps.filter((step) => !['proposal', 'approval', 'requirements'].includes(step.key)),
  ];

  if (states.approval) ordered = stepFor(ordered, 'approval', { state: states.approval });
  if (states.requirements && requirementsRequired) ordered = stepFor(ordered, 'requirements', { state: states.requirements });
  if (notes.approval) ordered = stepFor(ordered, 'approval', { note: notes.approval });
  if (notes.requirements) ordered = stepFor(ordered, 'requirements', { note: notes.requirements });
  return ordered;
}

function filesNote(progress) {
  return progress && progress.total > 0 ? `${progress.done} of ${progress.total} files uploaded.` : null;
}

function withProgress(body, progress) {
  const note = filesNote(progress);
  return note ? [body, note].filter(Boolean).join(' ') : body;
}

// Returns eventLifecycle's shape plus `action`, the one footer action for this viewer. `progress`
// is { done, total } for the SAO event files, when the caller has loaded it.
export function eventFlow(event, viewerRole, progress = null) {
  const e = event ?? {};
  const stage = e.approval_stage;
  const input = STAGE_INPUT[stage]?.(e) ?? {};
  const lifecycle = eventLifecycle({ ...e, ...input }, viewerRole);
  const requirementsRequired = e.requirements_required === true;
  const steps = orderSteps(lifecycle.steps, stage, requirementsRequired);
  let nextAction = { ...lifecycle.nextAction };
  let action = null;
  const selfLink = lifecycle.href;
  const hasLink = Boolean(nextAction.label && nextAction.to);
  const mine = nextAction.tone === 'action';

  if (stage === 'requirements_returned') {
    nextAction = {
      tone: viewerRole && viewerRole !== 'ADMIN' ? 'waiting' : 'action',
      title: viewerRole && viewerRole !== 'ADMIN' ? 'Returned to the Admin for new files' : 'Returned: read the remarks, replace the files',
      body: withProgress(e.approval_remarks || 'The SAO sent the files back. Replace them below and submit again.', progress),
    };
  } else if (stage === 'awaiting_requirements') {
    nextAction = { ...nextAction, body: withProgress(viewerRole && viewerRole !== 'ADMIN' ? 'The Department Head approved this event. The SAO needs the event files next.' : 'The Department Head approved this event. Upload each file below and submit them to the SAO.', progress) };
  } else if (FILE_STAGES.includes(stage) && requirementsRequired) {
    nextAction = { ...nextAction, body: withProgress(nextAction.body, progress) };
  }
  if (stage === 'awaiting_requirements' || stage === 'requirements_returned') {
    nextAction = { ...nextAction, label: undefined, to: undefined };
  } else if (mine && hasLink) {
    const label = nextAction.label === 'Prepare report' ? 'Prepare event report' : nextAction.label;
    if (nextAction.to === selfLink) {
      if (['not_submitted', 'rejected'].includes(stage) && viewerRole === 'ADMIN') {
        action = { label: stage === 'rejected' ? 'Edit and resubmit' : 'Edit proposal', kind: 'edit' };
      } else if (lifecycle.current?.key === 'prepare' && viewerRole === 'ADMIN') {
        action = { label: 'Mark ongoing', kind: 'start' };
      }
    } else if (!(viewerRole === 'SBO_OFFICER' && nextAction.to.startsWith('/dashboard/events/event-planner'))) {
      action = { label, to: nextAction.to };
    }
  }

  const prepare = lifecycle.current?.key === 'prepare' && ['ADMIN', 'SBO_OFFICER'].includes(viewerRole);
  const secondary = prepare ? { label: 'Book venue', to: `/dashboard/venues?event=${e.id}` } : null;

  return { ...lifecycle, steps, nextAction, action, secondary };
}

export function eventNextStepProps(flow) {
  const { tone, title, body } = flow.nextAction;
  return { tone, title, body, actorRole: roleLabel(flow.actorRole) ?? undefined };
}
