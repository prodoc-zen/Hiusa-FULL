import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { buildWorkspaces } from '../../hooks/useWorkspaces';
import { SUB_ACCOUNT_KEY } from '../../utils/subAccountStore';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderSwitcher(workspaces, role, onProfileChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/dashboard/student']}>
      <WorkspaceSwitcher workspaces={{ switching: false, switchError: '', ...workspaces }} role={role} onProfileChange={onProfileChange} />
      <Where />
    </MemoryRouter>,
  );
  return onProfileChange;
}

const profile = (id, role, name, extra = {}) => ({ id, role, account_status: 'active', organization: { id: id * 10, name, is_active: true, organization_type: role === 'STUDENT' ? 'COLLEGE' : 'STUDENT_ORGANIZATION' }, ...extra });

describe('WorkspaceSwitcher for an officer', () => {
  const profiles = [profile(1, 'STUDENT', 'College of Computing'), profile(2, 'SBO_OFFICER', 'Computing Society', { position_title: 'Treasurer' })];

  beforeEach(() => sessionStorage.clear());

  it('shows the current place and lists My account with each organization when opened', () => {
    renderSwitcher(buildWorkspaces({ role: 'STUDENT', profiles, activeProfileId: 1 }), 'STUDENT');
    const trigger = screen.getByRole('button', { name: 'Workspace: My account' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    const panel = screen.getByRole('region', { name: 'Workspaces' });
    expect(within(panel).getByRole('button', { name: /my account/i })).toHaveAttribute('aria-current', 'true');
    expect(within(panel).getByRole('button', { name: /Computing Society/ })).toHaveTextContent('SBO Officer · Treasurer');
  });

  it('lists names only, with no initials tile in front of them', () => {
    renderSwitcher(buildWorkspaces({ role: 'STUDENT', profiles, activeProfileId: 1 }), 'STUDENT');
    fireEvent.click(screen.getByRole('button', { name: 'Workspace: My account' }));

    const panel = screen.getByRole('region', { name: 'Workspaces' });
    expect(within(panel).getByRole('button', { name: /my account/i }).textContent).not.toMatch(/^ME/);
    expect(within(panel).getByRole('button', { name: /Computing Society/ }).textContent).toMatch(/^Computing Society/);
    expect(panel.querySelector('img')).toBeNull();
  });

  it('changes profile for real when an organization is picked', () => {
    const onProfileChange = renderSwitcher(buildWorkspaces({ role: 'STUDENT', profiles, activeProfileId: 1 }), 'STUDENT');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: My account' }));
    fireEvent.click(screen.getByRole('button', { name: /Computing Society/ }));

    expect(onProfileChange).toHaveBeenCalledWith(profiles[1]);
    expect(sessionStorage.getItem(SUB_ACCOUNT_KEY)).toBeNull();
  });

  it('goes back to the student profile from inside an organization', () => {
    const onProfileChange = renderSwitcher(buildWorkspaces({ role: 'SBO_OFFICER', profiles, activeProfileId: 2 }), 'SBO_OFFICER');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: Computing Society' }));
    fireEvent.click(screen.getByRole('button', { name: /my account/i }));

    expect(onProfileChange).toHaveBeenCalledWith(profiles[0]);
  });

  it('does nothing when the current place is picked again, and closes with Escape', () => {
    const onProfileChange = renderSwitcher(buildWorkspaces({ role: 'STUDENT', profiles, activeProfileId: 1 }), 'STUDENT');
    const trigger = screen.getByRole('button', { name: 'Workspace: My account' });

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('region', { name: 'Workspaces' })).getByRole('button', { name: /my account/i }));
    expect(onProfileChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Workspaces' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Workspaces' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('renders nothing for someone with a single place', () => {
    renderSwitcher(buildWorkspaces({ role: 'STUDENT', profiles: [profiles[0]], activeProfileId: 1 }), 'STUDENT');

    expect(screen.queryByRole('button', { name: /Workspace:/ })).not.toBeInTheDocument();
  });

  it('says so when a switch fails', () => {
    renderSwitcher({ ...buildWorkspaces({ role: 'STUDENT', profiles, activeProfileId: 1 }), switchError: 'Could not switch profile. Try again.' }, 'STUDENT');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: My account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Could not switch profile. Try again.');
  });
});

describe('WorkspaceSwitcher for a Department Head', () => {
  const organizations = [
    { id: 11, name: 'Computing Society', acronym: 'CS', members_count: 40 },
    { id: 12, name: 'Arts Guild', acronym: 'AG', members_count: 12 },
  ];

  beforeEach(() => sessionStorage.clear());

  it('opens an organization as a space of its own', () => {
    renderSwitcher(buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: organizations }), 'DEPARTMENT_HEAD');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: My college' }));
    fireEvent.click(screen.getByRole('button', { name: /Arts Guild/ }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/department-head/org/12');
    expect(JSON.parse(sessionStorage.getItem(SUB_ACCOUNT_KEY))).toMatchObject({ id: 12, name: 'Arts Guild' });
  });

  it('leaves the space and goes back to the dean view', () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 12, name: 'Arts Guild' }));
    renderSwitcher(buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: organizations, activeSubAccount: { id: 12 } }), 'DEPARTMENT_HEAD');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: Arts Guild' }));
    fireEvent.click(screen.getByRole('button', { name: /my college/i }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/department-head');
    expect(sessionStorage.getItem(SUB_ACCOUNT_KEY)).toBeNull();
  });

  it('shows no search for a short list, up to 8 places', () => {
    const few = Array.from({ length: 7 }, (_, index) => ({ id: 100 + index, name: `Club ${index}`, members_count: 1 }));
    renderSwitcher(buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: few }), 'DEPARTMENT_HEAD');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: My college' }));

    expect(screen.queryByRole('searchbox', { name: 'Search organizations' })).not.toBeInTheDocument();
  });

  it('searches the organizations once there are many', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ id: 100 + index, name: `Club ${index}`, members_count: 1 }));
    renderSwitcher(buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: many }), 'DEPARTMENT_HEAD');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace: My college' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search organizations' }), { target: { value: 'Club 7' } });

    expect(screen.getByRole('button', { name: /Club 7/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Club 1/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search organizations' }), { target: { value: 'zzz' } });
    expect(screen.getByText(/No organization matches/)).toBeInTheDocument();
  });
});
