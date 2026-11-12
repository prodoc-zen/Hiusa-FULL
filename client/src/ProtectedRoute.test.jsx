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
        <Route path="/" element={<p>Landing page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function signIn(user) {
  localStorage.setItem('auth_token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function renderVenues() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/venues']}>
      <Routes>
        <Route path="/dashboard/venues" element={<ProtectedRoute allowedRoles={['ADMIN', 'SBO_OFFICER']} requireVenueBooking><p>Venue booking page</p></ProtectedRoute>} />
        <Route path="/dashboard/officer" element={<p>Officer dashboard</p>} />
        <Route path="/dashboard/admin" element={<p>Admin dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute venue booking guard', () => {
  beforeEach(() => localStorage.clear());

  it('sends an officer whose position cannot book back to the officer dashboard', () => {
    signIn({ role: 'SBO_OFFICER', can_book_venues: false });
    renderVenues();
    expect(screen.getByText('Officer dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Venue booking page')).not.toBeInTheDocument();
  });

  it.each([
    ['an officer whose position can book', { role: 'SBO_OFFICER', can_book_venues: true }],
    ['an officer signed in before the flag existed', { role: 'SBO_OFFICER' }],
    ['an Admin', { role: 'ADMIN', can_book_venues: false }],
  ])('opens the page for %s', (_label, user) => {
    signIn(user);
    renderVenues();
    expect(screen.getByText('Venue booking page')).toBeInTheDocument();
  });
});

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

  it('sends a signed out visitor to the landing page first', () => {
    renderAt('/change-password');

    expect(screen.getByText('Landing page')).toBeInTheDocument();
  });
});
