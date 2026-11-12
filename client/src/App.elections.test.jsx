import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <Outlet /> }));

function Where({ name }) {
  const { pathname } = useLocation();
  return <p data-testid="landed">{name} {pathname}</p>;
}

// The hub shows its child page only for the pages that are stubs here; every other page stays the picker.
function HubStub() {
  const { pathname } = useLocation();
  return (
    <>
      <Where name="elections" />
      {/\/(applications|election-info)$/.test(pathname) ? <Outlet /> : null}
    </>
  );
}

vi.mock('./pages/modules/elections/ElectionsHub', () => ({ default: () => <HubStub /> }));
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
    ['STUDENT', 'applications', '/dashboard/student'],
    ['DEPARTMENT_HEAD', 'applications', '/dashboard/department-head'],
    ['DEPARTMENT_HEAD', 'election-info', '/dashboard/department-head'],
  ])('sends %s from %s home instead of opening a picker', async (role, page, home) => {
    visit(role, `/dashboard/elections/${page}`);
    expect(await screen.findByTestId('landed')).toHaveTextContent(`home ${home}`);
  });

  it('sends a student opening the elections list to their own Vote page, and leaves the Admin on the list', async () => {
    const student = visit('STUDENT', '/dashboard/elections');
    expect(await screen.findByTestId('landed')).toHaveTextContent('elections /dashboard/elections/cast-vote');
    student.unmount();

    localStorage.clear();
    visit('ADMIN', '/dashboard/elections/');
    expect((await screen.findByTestId('landed')).textContent).toBe('elections /dashboard/elections/');
  });

  it.each([
    ['ADMIN', 'manage-elections'],
    ['ADMIN', 'manage-candidates'],
    ['ADMIN', 'manage-partylists'],
    ['SBO_OFFICER', 'manage-candidates'],
    ['SBO_OFFICER', 'manage-voters'],
    ['STUDENT', 'cast-vote'],
    ['DEPARTMENT_HEAD', 'election-results'],
    ['ADMIN', 'applications'],
    ['SBO_OFFICER', 'applications'],
    ['ADMIN', 'election-info'],
    ['SBO_OFFICER', 'election-info'],
    ['STUDENT', 'election-info'],
  ])('keeps %s on %s, which is a page for that role', async (role, page) => {
    visit(role, `/dashboard/elections/${page}`);
    expect(await screen.findByTestId('landed')).toHaveTextContent(`elections /dashboard/elections/${page}`);
  });

  it.each([
    ['ADMIN', 'applications', 'Applications'],
    ['SBO_OFFICER', 'applications', 'Applications'],
    ['ADMIN', 'election-info', 'Election information'],
    ['SBO_OFFICER', 'election-info', 'Election information'],
    ['STUDENT', 'election-info', 'Election information'],
  ])('renders the %s page for %s', async (role, page, heading) => {
    visit(role, `/dashboard/elections/${page}`);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });
});

describe('officer transition page', () => {
  beforeEach(() => localStorage.clear());

  it.each(['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER'])('renders the page for %s', async (role) => {
    visit(role, '/dashboard/records/officer-transition');
    expect(await screen.findByRole('heading', { level: 1, name: 'Officer transition' })).toBeInTheDocument();
  });

  it('sends a student home instead of the page', async () => {
    visit('STUDENT', '/dashboard/records/officer-transition');
    expect(await screen.findByTestId('landed')).toHaveTextContent('home /dashboard/student');
    expect(screen.queryByRole('heading', { name: 'Officer transition' })).not.toBeInTheDocument();
  });
});
