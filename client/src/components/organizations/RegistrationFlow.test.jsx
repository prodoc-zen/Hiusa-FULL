import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RegistrationNextStep, RegistrationRowStatus, RegistrationStepper } from './RegistrationFlow';

const record = (overrides) => ({ id: 7, name: 'Chess Club', lifecycle_status: 'pending', administrators_count: 0, review_remarks: null, ...overrides });
const renderIn = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

const CASES = [
  ['DEPARTMENT_HEAD', { lifecycle_status: 'pending' }, 'Pending review: waiting for SAO review', 'waiting', null],
  ['DEPARTMENT_HEAD', { lifecycle_status: 'returned', review_remarks: 'Sign the constitution.' }, 'Returned: edit and resubmit', 'action', 'Edit and resubmit'],
  ['DEPARTMENT_HEAD', { lifecycle_status: 'active', administrators_count: 0 }, 'Approved: waiting for an administrator', 'waiting', null],
  ['DEPARTMENT_HEAD', { lifecycle_status: 'active', administrators_count: 1 }, 'Active: administrator can sign in', 'done', null],
  ['DEPARTMENT_HEAD', { lifecycle_status: 'active', administrators_count: undefined }, 'Active', 'done', null],
  ['DEPARTMENT_HEAD', { lifecycle_status: 'archived' }, 'Archived: read only', 'blocked', null],
  ['SUPER_ADMIN', { lifecycle_status: 'pending' }, 'Review this registration', 'action', 'Review registration'],
  ['SUPER_ADMIN', { lifecycle_status: 'returned' }, 'Waiting for the Department Head to resubmit', 'waiting', null],
  ['SUPER_ADMIN', { lifecycle_status: 'active', administrators_count: 0 }, 'Provision an administrator', 'action', 'Provision administrator'],
  ['SUPER_ADMIN', { lifecycle_status: 'active', administrators_count: 2 }, 'Active: administrator can sign in', 'done', null],
  ['SUPER_ADMIN', { lifecycle_status: 'archived' }, 'Archived: read only', 'blocked', null],
];

describe('RegistrationNextStep', () => {
  it.each(CASES)('%s sees "%s" for %j', (role, overrides, title, tone, button) => {
    renderIn(<RegistrationNextStep organization={record(overrides)} viewerRole={role} />);

    expect(screen.getByText(title)).toBeInTheDocument();
    if (tone === 'waiting' || tone === 'done') expect(screen.getByRole('status')).toBeInTheDocument();
    if (button) expect(screen.getByRole('link', { name: button })).toBeInTheDocument();
    else expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows no button on a waiting step and names the owner', () => {
    renderIn(<RegistrationNextStep organization={record()} viewerRole="DEPARTMENT_HEAD" />);

    expect(screen.getByRole('status')).toHaveTextContent('Owner: SAO');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('points the SAO at the prefilled administrator form', () => {
    renderIn(<RegistrationNextStep organization={record({ lifecycle_status: 'active' })} viewerRole="SUPER_ADMIN" />);

    expect(screen.getByRole('link', { name: 'Provision administrator' })).toHaveAttribute('href', '/dashboard/super-admin/admins?organization=7&create=1');
  });

  it('runs a handler instead of navigating when the page owns the action', () => {
    const onPrimary = vi.fn();
    renderIn(<RegistrationNextStep organization={record({ lifecycle_status: 'returned', review_remarks: 'Sign it.' })} viewerRole="DEPARTMENT_HEAD" onPrimary={onPrimary} />);

    screen.getByRole('button', { name: 'Edit and resubmit' }).click();
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sign it.')).toBeInTheDocument();
  });

  it('shows the SAO remarks to the SAO after a return', () => {
    renderIn(<RegistrationNextStep organization={record({ lifecycle_status: 'returned', review_remarks: 'Sign it.' })} viewerRole="SUPER_ADMIN" />);

    expect(screen.getByText('Your remarks: Sign it.')).toBeInTheDocument();
  });
});

describe('RegistrationStepper', () => {
  const stateOf = (list, label) => within(list).getByText(label).closest('li');

  it('marks the SAO review current for a pending registration', () => {
    render(<RegistrationStepper organization={record()} viewerRole="DEPARTMENT_HEAD" />);
    const list = screen.getByRole('list', { name: 'Registration progress for Chess Club' });

    expect(stateOf(list, 'Registered')).not.toHaveAttribute('aria-current');
    expect(stateOf(list, 'SAO review')).toHaveAttribute('aria-current', 'step');
  });

  it('blocks the SAO review step when the registration is returned', () => {
    render(<RegistrationStepper organization={record({ lifecycle_status: 'returned' })} viewerRole="DEPARTMENT_HEAD" />);
    const list = screen.getByRole('list', { name: 'Registration progress for Chess Club' });

    expect(within(stateOf(list, 'SAO review')).getByText(/Blocked/)).toBeInTheDocument();
    expect(within(stateOf(list, 'SAO review')).getByText('Returned')).toBeInTheDocument();
  });

  it('is complete when an active organization has an administrator', () => {
    render(<RegistrationStepper organization={record({ lifecycle_status: 'active', administrators_count: 1 })} viewerRole="SUPER_ADMIN" />);
    const list = screen.getByRole('list', { name: 'Registration progress for Chess Club' });

    expect(within(list).getAllByText(/^Done:/)).toHaveLength(4);
  });

  it('renders one line of progress in the compact variant', () => {
    render(<RegistrationStepper organization={record({ lifecycle_status: 'active' })} viewerRole="SUPER_ADMIN" variant="compact" />);

    expect(screen.getByRole('progressbar', { name: 'Registration progress for Chess Club' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('Step 3 of 4: Administrator')).toBeInTheDocument();
  });
});

describe('RegistrationRowStatus', () => {
  it('prints the next move as text above the compact stepper', () => {
    render(<RegistrationRowStatus organization={record({ lifecycle_status: 'returned' })} viewerRole="DEPARTMENT_HEAD" />);

    expect(screen.getByText('Returned: edit and resubmit')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
