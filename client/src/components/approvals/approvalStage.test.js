import { describe, expect, it } from 'vitest';
import { decisionMessage, describeApproval, entityLink } from './approvalStage';

const request = (overrides) => ({ id: 1, organization_id: 1, entity_id: 50, status: 'pending', required_role: 'DEPARTMENT_HEAD', remarks: null, requested_at: '2026-10-06T10:00:00+08:00', summary: {}, ...overrides });

describe('describeApproval for events', () => {
  const event = (overrides, summary = {}) => request({ entity_type: 'event', summary: { status: 'planning', requirement_files: [], ...summary }, ...overrides });

  it('waits on the Department Head while its approval is pending', () => {
    expect(describeApproval(event({}), 'ADMIN').stageText).toBe('Waiting for Department Head approval');
  });

  it('moves to the SAO once the head approved and the files are in', () => {
    const info = describeApproval(event({ status: 'approved' }, { requirement_files: [{ id: 1, original_name: 'a.pdf' }] }), 'ADMIN');

    expect(info.stageText).toBe('Waiting for SAO approval');
    expect(decisionMessage(event({ status: 'approved' }, { requirement_files: [{ id: 1 }] }))).toBe('Approved. Now with the SAO for requirements review');
  });

  it('asks the Admin for the SAO files when the head approved and none are in', () => {
    expect(describeApproval(event({ status: 'approved' }), 'ADMIN').stageText).toBe('Submit the SAO event files');
    expect(decisionMessage(event({ status: 'approved' }))).toBe('Approved. Waiting for the organization to submit the SAO event files');
  });

  it('reads Returned when the SAO sent the event back', () => {
    const info = describeApproval(event({ status: 'rejected', required_role: 'SUPER_ADMIN', remarks: 'Wrong form' }), 'ADMIN');

    expect(info.stageText).toBe('Returned: read the remarks, edit, resubmit');
  });

  it('reads plain Approved for an event the head approved outright', () => {
    expect(decisionMessage(event({ status: 'approved' }, { status: 'approved' }))).toBe('Approved');
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

describe('entityLink', () => {
  it('leaves out the link when the entity is gone, the type has no page, or the role has none', () => {
    expect(entityLink(request({ entity_type: 'event', summary: null }), 'ADMIN')).toBeNull();
    expect(entityLink(request({ entity_type: 'announcement' }), 'ADMIN')).toBeNull();
    expect(entityLink(request({ entity_type: 'event' }), 'STUDENT')).toBeNull();
  });
});
