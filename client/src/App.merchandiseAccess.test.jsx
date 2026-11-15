import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <Outlet /> }));

function Where({ name }) {
  const { pathname } = useLocation();
  return <p data-testid="landed">{name} {pathname}</p>;
}

// The real page reads the API; this file only checks which role reaches the inventory route.
vi.mock('./pages/modules/merchandise/MerchandisePage', () => ({ default: ({ initialTab }) => <Where name={`merchandise ${initialTab}`} /> }));
vi.mock('./pages/roles/student/StudentHomePage', () => ({ default: () => <Where name="home" /> }));
vi.mock('./pages/roles/officer/DashboardPage', () => ({ default: () => <Where name="home" /> }));
vi.mock('./pages/roles/department-head/DepartmentHeadHomePage', () => ({ default: () => <Where name="home" /> }));
vi.mock('./pages/roles/admin/AdminHomePage', () => ({ default: () => <Where name="home" /> }));

function visit(role, path) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('inventory page access', () => {
  beforeEach(() => localStorage.clear());

  it.each(['ADMIN', 'SBO_OFFICER'])('opens the inventory for %s', async (role) => {
    visit(role, '/dashboard/merchandise/manage-inventory');
    expect(await screen.findByTestId('landed')).toHaveTextContent('merchandise inventory /dashboard/merchandise/manage-inventory');
  });

  it.each([
    ['STUDENT', '/dashboard/student'],
    ['DEPARTMENT_HEAD', '/dashboard/department-head'],
  ])('sends %s home instead of the inventory', async (role, home) => {
    visit(role, '/dashboard/merchandise/manage-inventory');
    expect(await screen.findByTestId('landed')).toHaveTextContent(`home ${home}`);
  });
});
