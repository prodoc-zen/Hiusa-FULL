import { describe, expect, it } from 'vitest';
import { eventFlow } from '../events/eventStage';
import { decisionMessage, describeApproval, entityLink, waitingOnRole } from './approvalStage';

const request = (overrides) => ({ id: 1, organization_id: 1, entity_id: 50, status: 'pending', required_role: 'DEPARTMENT_HEAD', remarks: null, requested_at: '2026-10-06T10:00:00+08:00', summary: {}, ...overrides });

describe('describeApproval for events', () => {
  const event = (overrides, summary = {}) => request({ entity_type: 'event', summary: { status: 'planning', requirement_files: [], ...summary }, ...overrides });

  it('waits on the Department Head while its approval is pending', () => {
    expect(describeApproval(event({}), 'ADMIN').stageText).toBe('Waiting for Department Head approval');
  });

  it('labels the steps and the stage the way the event page does', () => {
    const summary = { approval_stage: 'awaiting_department_head' };
    const info = describeApproval(event({}, summary), 'ADMIN');
    const page = eventFlow({ id: 50, status: 'planning', ...summary }, 'ADMIN');

    expect(info.steps.map((step) => step.label)).toEqual(page.steps.map((step) => step.label));
    expect(info.steps.map((step) => step.label)).toContain('Department Head approval');
    expect(info.stageText).toBe(page.nextAction.title);
  });

  it('is with the SAO only after the organization sent the event on', () => {
    const summary = { approval_stage: 'awaiting_sao', requirement_files: [{ id: 1, original_name: 'a.pdf' }] };
    const info = describeApproval(event({ status: 'approved' }, summary), 'ADMIN');

    expect(info.stageText).toBe('Waiting for SAO approval');
    expect(decisionMessage(event({ status: 'approved' }, summary))).toBe('Approved. Now with the SAO for requirements review');
  });

  it('hands the event back to the organization to send when the head approved and the files are in', () => {
    const summary = { approval_stage: 'ready_for_sao', requirements_required: true, requirements_submitted: true, requirement_files: [{ id: 1 }] };

    expect(describeApproval(event({ status: 'approved' }, summary), 'ADMIN').stageText).toBe('Send the event to the SAO');
    expect(describeApproval(event({ status: 'approved' }, summary), 'DEPARTMENT_HEAD').stageText).toBe('Waiting for the Admin to send it to the SAO');
    expect(waitingOnRole(event({ status: 'approved' }, summary))).toBeNull();
    expect(decisionMessage(event({ status: 'approved' }, summary))).toBe('Approved. Returned to the organization to send to the SAO');
  });

  it('hands the event back to the organization when the head approved an event that needs no files', () => {
    const summary = { approval_stage: 'ready_for_sao', requirements_required: false, requirements_submitted: false };

    expect(decisionMessage(event({ status: 'approved' }, summary))).toBe('Approved. Returned to the organization to send to the SAO');
  });

  it('asks the Admin for the SAO files when the head approved and none are in', () => {
    const summary = { approval_stage: 'awaiting_requirements', requirements_required: true, requirements_submitted: false };

    expect(describeApproval(event({ status: 'approved' }, summary), 'ADMIN').stageText).toBe('Submit the SAO event files');
    expect(decisionMessage(event({ status: 'approved' }, summary))).toBe('Approved. Returned to the organization to upload the SAO event files and send them');
  });

  it('reads Returned when the SAO sent the event back', () => {
    const info = describeApproval(event({ status: 'rejected', required_role: 'SUPER_ADMIN', remarks: 'Wrong form' }), 'ADMIN');

    expect(info.stageText).toBe('Returned: read the remarks, edit, resubmit');
  });

  it('reads plain Approved for an event the head approved outright', () => {
    expect(decisionMessage(event({ status: 'approved' }, { status: 'approved' }))).toBe('Approved');
  });

  it('gives the SAO an Open approval link that carries the organization and the event', () => {
    const waiting = event({ status: 'approved', organization_id: 7, entity_id: 31 }, { approval_stage: 'awaiting_sao', requirement_files: [{ id: 1, original_name: 'a.pdf' }] });
    const info = describeApproval(waiting, 'SUPER_ADMIN');

    expect(info.lifecycle.nextAction.label).toBe('Open approval');
    expect(info.lifecycle.nextAction.to).toBe('/dashboard/super-admin/compliance?tab=event-reviews&organization=7&event=31');
  });

  it('gives the SAO the same link for an event the SAO itself holds', () => {
    const info = describeApproval(event({ required_role: 'SUPER_ADMIN', organization_id: 7, entity_id: 31 }), 'SUPER_ADMIN');

    expect(info.lifecycle.nextAction.to).toBe('/dashboard/super-admin/compliance?tab=event-reviews&organization=7&event=31');
  });
});

describe('describeApproval for the other lifecycles', () => {
  it('takes a budget and a report from the approval row when the summary has no status', () => {
    expect(describeApproval(request({ entity_type: 'budget' }), 'ADMIN').stageText).toBe('Waiting for Department Head approval');
    expect(describeApproval(request({ entity_type: 'budget', status: 'rejected', remarks: 'Too high' }), 'ADMIN').stageText).toBe('Returned: edit and resubmit');
    expect(describeApproval(request({ entity_type: 'financial_report', required_role: 'SUPER_ADMIN' }), 'ADMIN').stageText).toBe('Waiting for SAO approval');
  });

  it('shows an approved election at the ballot stage and a pending one under review', () => {
    expect(describeApproval(request({ entity_type: 'election' }), 'ADMIN').stageText).toBe('Awaiting Department Head review');
    expect(describeApproval(request({ entity_type: 'election', status: 'approved', summary: { target_status: 'upcoming' } }), 'ADMIN').stageText).toBe('Build the ballot');
  });

  it('gives announcements and payments a chip instead of a stepper', () => {
    const info = describeApproval(request({ entity_type: 'announcement', required_role: 'ADMIN' }), 'SBO_OFFICER');

    expect(info).toMatchObject({ kind: 'chip', stageText: 'Waiting for Admin approval' });
    expect(describeApproval(request({ entity_type: 'payment', required_role: 'ADMIN' }), 'ADMIN').stageText).toBe('Waiting for your decision');
  });
});

describe('waitingOnRole', () => {
  it('names the role holding a pending request and nobody once the head has decided', () => {
    expect(waitingOnRole(request({ entity_type: 'budget' }))).toBe('DEPARTMENT_HEAD');
    expect(waitingOnRole(request({ entity_type: 'announcement' }))).toBe('DEPARTMENT_HEAD');
    expect(waitingOnRole(request({ entity_type: 'budget', status: 'rejected' }))).toBeNull();
    expect(waitingOnRole(request({ entity_type: 'announcement', status: 'approved' }))).toBeNull();
  });

  it('holds a head-approved event with the organization until it sends the event to the SAO', () => {
    const approved = (stage) => request({ entity_type: 'event', status: 'approved', summary: { status: 'planning', approval_stage: stage, requirement_files: [{ id: 1 }] } });

    expect(waitingOnRole(approved('awaiting_sao'))).toBe('SUPER_ADMIN');
    expect(waitingOnRole(approved('ready_for_sao'))).toBeNull();
    expect(waitingOnRole(approved('awaiting_requirements'))).toBeNull();
  });
});

describe('entityLink', () => {
  it('leaves out the link when the entity is gone, the type has no page, or the role has none', () => {
    expect(entityLink(request({ entity_type: 'event', summary: null }), 'ADMIN')).toBeNull();
    expect(entityLink(request({ entity_type: 'announcement' }), 'ADMIN')).toBeNull();
    expect(entityLink(request({ entity_type: 'event' }), 'STUDENT')).toBeNull();
  });
});

describe('unified organization approvals', () => {
  it('routes a university-wide election to SAO and gives the admin the correct waiting message', () => {
    const election = request({ entity_type: 'election', required_role: 'SUPER_ADMIN' });
    const sao = describeApproval(election, 'SUPER_ADMIN');
    expect(sao.stageText).toBe('Review this election');
    expect(sao.lifecycle.actorRole).toBe('SUPER_ADMIN');
    expect(sao.lifecycle.nextAction.to).toBe('/dashboard/super-admin/organization-approvals');
    expect(describeApproval(election, 'ADMIN').stageText).toBe('Awaiting SAO review');
  });
});
