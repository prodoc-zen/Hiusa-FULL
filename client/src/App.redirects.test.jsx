import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <Outlet /> }));

function Where({ name }) {
  const { pathname, search } = useLocation();
  return <p data-testid="landed">{name} {pathname}{search}</p>;
}

vi.mock('./pages/modules/tasks/TasksPage', () => ({ default: () => <Where name="tasks" /> }));
vi.mock('./pages/modules/events/EventsPage', () => ({ default: () => <Where name="events" /> }));
vi.mock('./pages/roles/admin/ManageSboPositionsPage', () => ({ default: () => <Where name="positions" /> }));
vi.mock('./pages/roles/department-head/DepartmentHeadApprovalsPage', () => ({ default: () => <Where name="approvals" /> }));
vi.mock('./pages/modules/announcements/CreateAnnouncementPage', () => ({ default: () => <Where name="create-announcement" /> }));

function visit(role, path) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('merged and demoted routes', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['ADMIN', '/dashboard/admin/sbo-positions', 'positions /dashboard/admin/positions'],
    ['DEPARTMENT_HEAD', '/dashboard/approvals', 'approvals /dashboard/department-head/approvals'],
  ])('sends %s from %s to the surviving page with its query', async (role, path, landed) => {
    visit(role, path);
    expect(await screen.findByTestId('landed')).toHaveTextContent(landed);
  });

  it.each([
    ['SBO_OFFICER', '/dashboard/events/activity-calendar', 'events'],
    ['STUDENT', '/dashboard/events/activity-calendar', 'events'],
    ['DEPARTMENT_HEAD', '/dashboard/events/activity-calendar', 'events'],
    ['ADMIN', '/dashboard/approvals', 'approvals'],
    ['ADMIN', '/dashboard/announcements/create-announcement', 'create-announcement'],
    ['ADMIN', '/dashboard/admin/positions', 'positions'],
    ['ADMIN', '/dashboard/tasks/task-board', 'tasks'],
  ])('leaves %s on %s, which stays a page for that role', async (role, path, name) => {
    visit(role, path);
    expect(await screen.findByTestId('landed')).toHaveTextContent(`${name} ${path}`);
  });
});
