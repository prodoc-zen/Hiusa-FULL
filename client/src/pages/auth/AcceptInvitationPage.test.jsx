import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptInvitationPage from './AcceptInvitationPage';

const mocks = vi.hoisted(() => ({
  getDepartmentHeadInvitation: vi.fn(),
  acceptDepartmentHeadInvitation: vi.fn(),
  login: vi.fn(),
}));

vi.mock('../../services/systemAdministrationService', () => ({
  getDepartmentHeadInvitation: mocks.getDepartmentHeadInvitation,
  acceptDepartmentHeadInvitation: mocks.acceptDepartmentHeadInvitation,
}));
vi.mock('../../services/authService', () => ({ login: mocks.login }));

const deanInvite = {
  invitation: { role: 'DEPARTMENT_HEAD', position_title: null, expires_at: '2026-11-10T00:00:00Z' },
  college: { id: 5, name: 'College of Arts and Sciences', code: 'CAS' },
};

const staffInvite = {
  invitation: { role: 'COLLEGE_STAFF', position_title: 'College Secretary', expires_at: '2026-11-10T00:00:00Z' },
  college: { id: 5, name: 'College of Arts and Sciences', code: 'CAS' },
};

function renderPage(path = '/accept-invitation?token=valid-secret-token') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/dashboard/department-head" element={<p>Dean home</p>} />
        <Route path="/dashboard/admin" element={<p>Staff home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillForm(overrides = {}) {
  const values = { first: 'Arthur', last: 'Dent', email: 'Arthur.Dent@Example.edu ', password: 'Password123!', confirm: 'Password123!', ...overrides };
  type(/First name/, values.first);
  type(/Last name/, values.last);
  type(/^Email/, values.email);
  type(/^Password/, values.password);
  type(/^Confirm password/, values.confirm);
}

describe('AcceptInvitationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows a plain error when the link has no code', async () => {
    renderPage('/accept-invitation');

    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
    expect(screen.getByText(/missing its code/i)).toBeInTheDocument();
    expect(mocks.getDepartmentHeadInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows a loading state while the link is checked', async () => {
    mocks.getDepartmentHeadInvitation.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading invitation' })).toBeInTheDocument();
  });

  it('shows an expired or used link as an error state', async () => {
    mocks.getDepartmentHeadInvitation.mockRejectedValue({ response: { status: 410, data: { message: 'This link has expired. Ask for a new one.' } } });
    renderPage();

    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
    expect(screen.getByText('This link has expired. Ask for a new one.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
  });

  it('offers a retry when the server is down, not a dead end', async () => {
    mocks.getDepartmentHeadInvitation.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    mocks.getDepartmentHeadInvitation.mockResolvedValueOnce(deanInvite);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: "You're invited to lead College of Arts and Sciences" })).toBeInTheDocument();
  });

  it('asks the dean for their own details and never for a school ID', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    renderPage();

    expect(await screen.findByRole('heading', { name: "You're invited to lead College of Arts and Sciences" })).toBeInTheDocument();
    [/^First name/, /^Last name/, /^Email/, /^Employee number \(optional\)/, /^Password/, /^Confirm password/].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/School ID/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Create account/ })).toHaveLength(1);
  });

  it('registers the dean, signs them in with their email and lands on the dean home', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockResolvedValue({ token: 'ignored', user: { role: 'DEPARTMENT_HEAD' } });
    mocks.login.mockResolvedValue({ data: { access_token: 'real-token', user: { school_id: 95000000, role: 'DEPARTMENT_HEAD', first_name: 'Arthur' } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.acceptDepartmentHeadInvitation).toHaveBeenCalledWith('valid-secret-token', {
      first_name: 'Arthur',
      last_name: 'Dent',
      email: 'arthur.dent@example.edu',
      password: 'Password123!',
      password_confirmation: 'Password123!',
    }));
    expect(mocks.login).toHaveBeenCalledWith({ identifier: 'arthur.dent@example.edu', password: 'Password123!' });
    expect(await screen.findByText('Dean home')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('real-token');
  });

  it('sends the employee number only when it is filled in', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockResolvedValue({});
    mocks.login.mockResolvedValue({ data: { access_token: 't', user: { role: 'DEPARTMENT_HEAD' } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    type(/Employee number/, '20261001');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.acceptDepartmentHeadInvitation).toHaveBeenCalledWith('valid-secret-token', expect.objectContaining({ school_id: 20261001 })));
  });

  it('greets office staff with their role and sends them to the staff home', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(staffInvite);
    mocks.acceptDepartmentHeadInvitation.mockResolvedValue({});
    mocks.login.mockResolvedValue({ data: { access_token: 't', user: { role: 'ADMIN' } } });
    renderPage();

    expect(await screen.findByRole('heading', { name: "You're invited to College of Arts and Sciences as office staff" })).toBeInTheDocument();
    expect(screen.getByText(/Your role: College Secretary/)).toBeInTheDocument();
    fillForm({ first: 'Clara', last: 'Cruz', email: 'clara@example.edu' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Staff home')).toBeInTheDocument();
  });

  it('validates the form before sending anything', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter your first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your last name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Choose a password.')).toBeInTheDocument();

    fillForm({ confirm: 'Mismatch!!' });
    type(/Employee number/, 'abc');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(screen.getByText('Use up to 8 digits, or leave it blank.')).toBeInTheDocument();
    expect(mocks.acceptDepartmentHeadInvitation).not.toHaveBeenCalled();
  });

  it('shows server field errors under the field and keeps what was typed', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockRejectedValue({ response: { status: 422, data: { message: 'invalid', errors: { email: ['The email has already been taken.'] } } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('The email has already been taken.')).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toHaveValue('Arthur');
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('turns a link used in the meantime into the error state', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockRejectedValue({ response: { status: 410, data: { message: 'This link was already used. Sign in instead.' } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
    expect(screen.getByText('This link was already used. Sign in instead.')).toBeInTheDocument();
  });

  it('shows a conflict from the server as a message above the button', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockRejectedValue({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This college already has an active Department Head.');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('falls back to the sign-in page when the account was made but the automatic sign-in failed', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockResolvedValue({});
    mocks.login.mockRejectedValue({ response: { status: 429 } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
