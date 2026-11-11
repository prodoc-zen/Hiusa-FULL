import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <Outlet /> }));

function Where({ name }) {
  const { pathname } = useLocation();
  return <p data-testid="landed">{name} {pathname}</p>;
}

vi.mock('./pages/modules/elections/ElectionsHub', () => ({ default: () => <Where name="elections" /> }));
vi.mock('./pages/roles/student/StudentHomePage', () => ({ default: () => <Where name="home" /> }));
vi.mock('./pages/roles/officer/DashboardPage', () => ({ default: () => <Where name="home" /> }));
vi.mock('./pages/roles/department-head/DepartmentHeadHomePage', () => ({ default: () => <Where name="home" /> }));
vi.mock('./pages/roles/admin/AdminHomePage', () => ({ default: () => <Where name="home" /> }));

function visit(role, path) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('election pages meant for one role', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['STUDENT', 'manage-elections', '/dashboard/student'],
    ['STUDENT', 'manage-voters', '/dashboard/student'],
    ['STUDENT', 'manage-candidates', '/dashboard/student'],
    ['STUDENT', 'manage-partylists', '/dashboard/student'],
    ['SBO_OFFICER', 'manage-elections', '/dashboard/officer'],
    ['SBO_OFFICER', 'manage-partylists', '/dashboard/officer'],
    ['DEPARTMENT_HEAD', 'manage-candidates', '/dashboard/department-head'],
    ['DEPARTMENT_HEAD', 'manage-partylists', '/dashboard/department-head'],
    ['DEPARTMENT_HEAD', 'manage-voters', '/dashboard/department-head'],
    ['DEPARTMENT_HEAD', 'manage-elections', '/dashboard/department-head'],
    ['ADMIN', 'manage-voters', '/dashboard/admin'],
  ])('sends %s from %s home instead of opening a picker', async (role, page, home) => {
    visit(role, `/dashboard/elections/${page}`);
    expect(await screen.findByTestId('landed')).toHaveTextContent(`home ${home}`);
  });

  it.each([
    ['ADMIN', 'manage-elections'],
    ['ADMIN', 'manage-candidates'],
    ['ADMIN', 'manage-partylists'],
    ['SBO_OFFICER', 'manage-candidates'],
    ['SBO_OFFICER', 'manage-voters'],
    ['STUDENT', 'cast-vote'],
    ['DEPARTMENT_HEAD', 'election-results'],
  ])('keeps %s on %s, which is a page for that role', async (role, page) => {
    visit(role, `/dashboard/elections/${page}`);
    expect(await screen.findByTestId('landed')).toHaveTextContent(`elections /dashboard/elections/${page}`);
  });
});
