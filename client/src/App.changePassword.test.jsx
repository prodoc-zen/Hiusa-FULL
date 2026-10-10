import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <Outlet /> }));
vi.mock('./pages/auth/ChangePasswordPage', () => ({ default: () => <p>Change password page</p> }));
vi.mock('./pages/roles/student/StudentHomePage', () => ({ default: () => <p>Student home</p> }));

function visit(path, user) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('change password route', () => {
  beforeEach(() => localStorage.clear());

  it.each(['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])('opens for a signed in %s', async (role) => {
    visit('/change-password', { role, must_change_password: false });

    expect(await screen.findByText('Change password page')).toBeInTheDocument();
  });

  it('catches a flagged user on any dashboard route', async () => {
    visit('/dashboard/student', { role: 'STUDENT', must_change_password: true });

    expect(await screen.findByText('Change password page')).toBeInTheDocument();
    expect(screen.queryByText('Student home')).not.toBeInTheDocument();
  });

  it('keeps a signed out visitor on the login flow', async () => {
    localStorage.clear();
    render(<MemoryRouter initialEntries={['/change-password']}><App /></MemoryRouter>);

    expect(screen.queryByText('Change password page')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Sign in to HIUSA' })).toBeInTheDocument();
  });
});
