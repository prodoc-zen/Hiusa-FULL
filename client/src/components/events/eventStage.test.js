import { describe, expect, it } from 'vitest';
import { eventFlow, stageText } from './eventStage';

const base = { id: 7, status: 'planning', requires_budget: false, budgets: [], tasks_count: 0, completed_tasks_count: 0, requirements_required: false, requirements_submitted: false, approval_id: 3, approval_status: null, approval_required_role: null, approval_remarks: null };
const states = (flow) => Object.fromEntries(flow.steps.map((step) => [step.key, step.state]));

describe('eventFlow', () => {
  it('orders the steps as the chain runs: Department Head, then the SAO files', () => {
    const keys = eventFlow({ ...base, approval_stage: 'not_submitted' }, 'ADMIN').steps.map((step) => step.key);
    expect(keys).toEqual(['proposal', 'approval', 'requirements', 'funding', 'prepare', 'run', 'report']);
  });

  it('not_submitted: the proposal is the current step and the Admin edits it', () => {
    const flow = eventFlow({ ...base, approval_stage: 'not_submitted' }, 'ADMIN');
    expect(states(flow)).toMatchObject({ proposal: 'current', approval: 'upcoming', requirements: 'skipped' });
    expect(flow.action).toEqual({ label: 'Edit proposal', kind: 'edit' });
  });

  it('awaiting_department_head: the head owns it and the files step is still ahead', () => {
    const event = { ...base, approval_stage: 'awaiting_department_head', approval_status: 'pending', approval_required_role: 'DEPARTMENT_HEAD', requirements_required: true };
    const forAdmin = eventFlow(event, 'ADMIN');
    expect(states(forAdmin)).toMatchObject({ proposal: 'done', approval: 'current', requirements: 'upcoming' });
    expect(forAdmin.nextAction).toMatchObject({ tone: 'waiting', title: 'Waiting for Department Head approval' });
    expect(forAdmin.action).toBeNull();
    expect(eventFlow(event, 'DEPARTMENT_HEAD').action).toMatchObject({ label: 'Open approval', to: '/dashboard/department-head/approvals?record=3' });
  });

  it('awaiting_requirements: the head step is done and the files step is current, with the upload count', () => {
    const event = { ...base, approval_stage: 'awaiting_requirements', approval_status: 'approved', requirements_required: true };
    const flow = eventFlow(event, 'ADMIN', { done: 2, total: 3 });
    expect(states(flow)).toMatchObject({ approval: 'done', requirements: 'current' });
    expect(flow.nextAction.title).toBe('Submit the SAO event files');
    expect(flow.nextAction.body).toContain('2 of 3 files uploaded.');
    expect(flow.action).toBeNull();
  });

  it('awaiting_sao: the SAO owns it, as a waiting step with no action', () => {
    const flow = eventFlow({ ...base, approval_stage: 'awaiting_sao', approval_status: 'pending', approval_required_role: 'SUPER_ADMIN', requirements_required: true, requirements_submitted: true }, 'ADMIN', { done: 3, total: 3 });
    expect(states(flow)).toMatchObject({ approval: 'done', requirements: 'current' });
    expect(flow.steps[2].note).toBe('Waiting for SAO');
    expect(flow.nextAction).toMatchObject({ tone: 'waiting', title: 'Waiting for SAO approval' });
    expect(flow.nextAction.body).toContain('3 of 3 files uploaded.');
    expect(flow.action).toBeNull();
  });

  it('requirements_returned: the files step is blocked and the Admin reads the remarks', () => {
    const flow = eventFlow({ ...base, approval_stage: 'requirements_returned', approval_status: 'rejected', approval_remarks: 'Permit expired.', requirements_required: true }, 'ADMIN');
    expect(states(flow)).toMatchObject({ approval: 'done', requirements: 'blocked' });
    expect(flow.nextAction).toMatchObject({ tone: 'action', title: 'Returned: read the remarks, replace the files' });
    expect(flow.nextAction.body).toContain('Permit expired.');
  });

  it('approved: both approval steps are done and the next step is preparation', () => {
    const flow = eventFlow({ ...base, status: 'approved', approval_stage: 'approved', approval_status: 'approved', requirements_required: true, requirements_submitted: true }, 'ADMIN');
    expect(states(flow)).toMatchObject({ proposal: 'done', approval: 'done', requirements: 'done', prepare: 'current' });
    expect(flow.secondary).toEqual({ label: 'Book venue', to: '/dashboard/venues?event=7' });
  });

  it('rejected: the head step is blocked and the files step is not started', () => {
    const flow = eventFlow({ ...base, approval_stage: 'rejected', approval_status: 'rejected', approval_remarks: 'Pick another date.', requirements_required: true }, 'ADMIN');
    expect(states(flow)).toMatchObject({ approval: 'blocked', requirements: 'upcoming' });
    expect(flow.steps[1].note).toBe('Returned');
    expect(flow.action).toEqual({ label: 'Edit and resubmit', kind: 'edit' });
  });

  it('generates the Propose budget, Book venue and Prepare event report links from the event id', () => {
    const funding = eventFlow({ ...base, status: 'approved', approval_stage: 'approved', approval_status: 'approved', requires_budget: true }, 'ADMIN');
    expect(funding.action).toEqual({ label: 'Propose budget', to: '/dashboard/finance/budget-allocation?event=7' });
    const report = eventFlow({ ...base, status: 'completed', approval_stage: 'approved', approval_status: 'approved' }, 'ADMIN');
    expect(report.action).toEqual({ label: 'Prepare event report', to: '/dashboard/finance/transaction-history?event=7' });
    const venue = eventFlow({ ...base, status: 'approved', approval_stage: 'approved', approval_status: 'approved' }, 'SBO_OFFICER');
    expect(venue.secondary.to).toBe('/dashboard/venues?event=7');
    expect(venue.action).toBeNull();
  });

  it('names a text for every stage that has one', () => {
    expect(stageText({ approval_stage: 'awaiting_requirements' })).toBe('SAO files needed');
    expect(stageText({ approval_stage: 'approved' })).toBe('Approved');
    expect(stageText({})).toBeNull();
  });
});
