import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import useAccessDeniedNotice from './hooks/useAccessDeniedNotice';

// The real dashboard layout runs the access-denied notice hook, so the mock layout does too: that hook rewrites the
// location it was handed, which is where a redirect to the bare /dashboard got lost.
function NoticeLayout() {
  useAccessDeniedNotice();
  return <Outlet />;
}

vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <NoticeLayout /> }));

vi.mock('./services/authService', async (importOriginal) => ({
  ...(await importOriginal()),
  getAccountProfiles: vi.fn(() => Promise.resolve({ data: { active_profile_id: 1, profiles: [] } })),
  switchAccountProfile: vi.fn(),
}));

vi.mock('./lib/notify', () => ({ default: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

function Where({ name }) {
  const { pathname, search } = useLocation();
  return <p data-testid="landed">{name} {pathname}{search}</p>;
}

vi.mock('./pages/roles/super-admin/SuperAdminHomePage', () => ({ default: () => <Where name="sao-home" /> }));
vi.mock('./pages/roles/admin/AdminHomePage', () => ({ default: () => <Where name="admin-home" /> }));
vi.mock('./pages/roles/admin/OfficeStaffHomePage', () => ({ default: () => <Where name="office-home" /> }));
vi.mock('./pages/roles/officer/DashboardPage', () => ({ default: () => <Where name="officer-home" /> }));
vi.mock('./pages/roles/department-head/DepartmentHeadHomePage', () => ({ default: () => <Where name="dean-home" /> }));
vi.mock('./pages/roles/student/StudentHomePage', () => ({ default: () => <Where name="student-home" /> }));

function visit(user, path) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify({ first_name: 'Test', last_name: 'User', ...user }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const STUDENT_ORG = { organization_type: 'STUDENT_ORGANIZATION' };

describe('a forbidden page sends each role to its own landing', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['SAO', { role: 'SUPER_ADMIN' }, '/dashboard/admin', 'sao-home /dashboard/super-admin'],
    ['SAO on a student page', { role: 'SUPER_ADMIN' }, '/dashboard/student', 'sao-home /dashboard/super-admin'],
    ['organization Admin', { role: 'ADMIN', organization: STUDENT_ORG }, '/dashboard/super-admin', 'admin-home /dashboard/admin'],
    ['office staff', { role: 'ADMIN', organization: { organization_type: 'COLLEGE' } }, '/dashboard/super-admin', 'office-home /dashboard/admin'],
    ['SBO officer', { role: 'SBO_OFFICER' }, '/dashboard/super-admin', 'officer-home /dashboard/officer'],
    ['Department Head', { role: 'DEPARTMENT_HEAD' }, '/dashboard/super-admin', 'dean-home /dashboard/department-head'],
    ['student', { role: 'STUDENT' }, '/dashboard/super-admin', 'student-home /dashboard/student'],
  ])('%s', async (_label, user, path, landed) => {
    visit(user, path);
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent(landed));
    // Let the notice hook finish its own navigation, then confirm the person is still on the landing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('landed')).toHaveTextContent(landed);
  });
});
