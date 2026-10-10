import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard/student" element={<p>Student dashboard</p>} />
          <Route path="/change-password" element={<p>Change password page</p>} />
        </Route>
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function signIn(user) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

describe('ProtectedRoute password change guard', () => {
  beforeEach(() => localStorage.clear());

  it('sends a signed in user who must change the password to the change password page', () => {
    signIn({ role: 'STUDENT', must_change_password: true });

    renderAt('/dashboard/student');

    expect(screen.getByText('Change password page')).toBeInTheDocument();
    expect(screen.queryByText('Student dashboard')).not.toBeInTheDocument();
  });

  it('lets that user stay on the change password page', () => {
    signIn({ role: 'STUDENT', must_change_password: true });

    renderAt('/change-password');

    expect(screen.getByText('Change password page')).toBeInTheDocument();
  });

  it('opens the dashboard for a user whose password is already their own', () => {
    signIn({ role: 'STUDENT', must_change_password: false });

    renderAt('/dashboard/student');

    expect(screen.getByText('Student dashboard')).toBeInTheDocument();
  });

  it('still sends a signed out visitor to login first', () => {
    renderAt('/change-password');

    expect(screen.getByText('Login page')).toBeInTheDocument();
  });
});
