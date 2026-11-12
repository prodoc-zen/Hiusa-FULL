import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptInvitationPage from './AcceptInvitationPage';

const mocks = vi.hoisted(() => ({
  getDepartmentHeadInvitation: vi.fn(),
  acceptDepartmentHeadInvitation: vi.fn(),
  login: vi.fn(),
  claimStaffInvitation: vi.fn(),
  switchAccountProfile: vi.fn(),
}));

vi.mock('../../services/systemAdministrationService', () => ({
  getDepartmentHeadInvitation: mocks.getDepartmentHeadInvitation,
  acceptDepartmentHeadInvitation: mocks.acceptDepartmentHeadInvitation,
  claimStaffInvitation: mocks.claimStaffInvitation,
}));
vi.mock('../../services/authService', () => ({ login: mocks.login, switchAccountProfile: mocks.switchAccountProfile }));

const deanInvite = {
  invitation: { role: 'DEPARTMENT_HEAD', position_title: null, expires_at: '2026-11-10T00:00:00Z' },
  college: { id: 5, name: 'College of Arts and Sciences', code: 'CAS' },
};

const staffInvite = {
  invitation: { role: 'COLLEGE_STAFF', position_title: 'College Secretary', expires_at: '2026-11-10T00:00:00Z' },
  college: { id: 5, name: 'College of Arts and Sciences', code: 'CAS' },
};

const recordInvite = {
  invitation: { role: 'COLLEGE_STAFF', position_title: 'Department Secretary', expires_at: '2026-11-10T00:00:00Z', record: { school_id: 7100101, first_name: 'Marites', last_name: 'Dizon' } },
  college: { id: 5, name: 'College of Arts and Sciences', code: 'CAS' },
};

const existingInvite = {
  invitation: { role: 'COLLEGE_STAFF', position_title: 'Dean Assistant', existing_account: true, expires_at: '2026-11-10T00:00:00Z', record: { school_id: 7100101, first_name: 'Marites', last_name: 'Dizon' } },
  college: { id: 5, name: 'College of Arts and Sciences', code: 'CAS' },
};

const prefilledInvite = {
  invitation: { role: 'COLLEGE_STAFF', position_title: 'Lab Technician', existing_account: false, prefill: { email: 'ramon@example.edu' }, expires_at: '2026-11-10T00:00:00Z' },
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

const summary = () => screen.getByRole('group', { name: 'There is a problem' });
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillForm(overrides = {}) {
  const values = { first: 'Arthur', last: 'Dent', schoolId: '20261234', email: 'Arthur.Dent@Example.edu ', password: 'Password123!', confirm: 'Password123!', ...overrides };
  type(/First name/, values.first);
  type(/Last name/, values.last);
  type(/^School ID/, values.schoolId);
  type(/^Email/, values.email);
  type(/^Password/, values.password);
  type(/^Confirm password/, values.confirm);
}

describe('AcceptInvitationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows one title and one next step when the link has no code', async () => {
    renderPage('/accept-invitation');

    expect(await screen.findByRole('heading', { level: 1, name: 'This invitation link is incomplete' })).toBeInTheDocument();
    expect(screen.getByText(/Open the link exactly as it was sent/)).toBeInTheDocument();
    expect(mocks.getDepartmentHeadInvitation).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
  });

  it('shows a loading state while the link is checked', async () => {
    mocks.getDepartmentHeadInvitation.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading invitation' })).toBeInTheDocument();
  });

  it('shows an expired link with one title and one next step', async () => {
    mocks.getDepartmentHeadInvitation.mockRejectedValue({ response: { status: 410, data: { message: 'This link has expired. Ask for a new one.' } } });
    renderPage();

    expect(await screen.findByText('This invitation link has expired')).toBeInTheDocument();
    expect(screen.getByText('Ask the office that sent it for a new one.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('sends someone with a used link to sign in', async () => {
    mocks.getDepartmentHeadInvitation.mockRejectedValue({ response: { status: 410, data: { message: 'This link was already used. Sign in instead.' } } });
    renderPage();

    expect(await screen.findByText('This invitation link was already used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('offers a retry when the server is down, not a dead end', async () => {
    mocks.getDepartmentHeadInvitation.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    mocks.getDepartmentHeadInvitation.mockResolvedValueOnce(deanInvite);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: "You're invited to lead College of Arts and Sciences" })).toBeInTheDocument();
  });

  it('asks the dean for their own name, School ID, email and password', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    renderPage();

    expect(await screen.findByRole('heading', { name: "You're invited to lead College of Arts and Sciences" })).toBeInTheDocument();
    [/^First name/, /^Last name/, /^School ID/, /^Email/, /^Password/, /^Confirm password/].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^School ID/)).toBeRequired();
    expect(screen.getByLabelText(/^School ID/)).not.toHaveAttribute('readonly');
    expect(screen.getAllByRole('button', { name: /Create account/ })).toHaveLength(1);
  });

  it('says who invited the dean and who invited office staff', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    const { unmount } = renderPage();
    expect(await screen.findByText(/Invited by the Student Affairs Office\./)).toBeInTheDocument();
    unmount();

    mocks.getDepartmentHeadInvitation.mockResolvedValue(staffInvite);
    renderPage();
    expect(await screen.findByText(/Invited by the Department Head of College of Arts and Sciences\./)).toBeInTheDocument();
  });

  it('names the person who invited you, from the Student Affairs Office for a dean', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue({ ...deanInvite, invitation: { ...deanInvite.invitation, inviter: { name: 'Jade Santos' } } });
    renderPage();

    expect(await screen.findByText('Jade Santos from the Student Affairs Office invited you to College of Arts and Sciences.')).toBeInTheDocument();
    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument();
  });

  it('names the dean who invited office staff', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue({ ...staffInvite, invitation: { ...staffInvite.invitation, inviter: { name: 'Rosa Lim' } } });
    renderPage();

    expect(await screen.findByText(/Rosa Lim, the Department Head, invited you to College of Arts and Sciences\./)).toBeInTheDocument();
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
      school_id: 20261234,
      email: 'arthur.dent@example.edu',
      password: 'Password123!',
      password_confirmation: 'Password123!',
    }));
    expect(mocks.login).toHaveBeenCalledWith({ identifier: 'arthur.dent@example.edu', password: 'Password123!' });
    expect(await screen.findByText('Dean home')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('real-token');
  });

  it('shows the name and School ID from the school records read only and asks only for email and password', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(recordInvite);
    mocks.acceptDepartmentHeadInvitation.mockResolvedValue({});
    mocks.login.mockResolvedValue({ data: { access_token: 't', user: { role: 'ADMIN' } } });
    renderPage();

    await screen.findByRole('heading', { name: /as office staff/ });
    expect(screen.getByLabelText('Name')).toHaveValue('Marites Dizon');
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('School ID')).toHaveValue('7100101');
    expect(screen.getByLabelText('School ID')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText(/^First name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Last name/)).not.toBeInTheDocument();

    type(/^Email/, 'Marites@Example.edu');
    type(/^Password/, 'Password123!');
    type(/^Confirm password/, 'Password123!');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.acceptDepartmentHeadInvitation).toHaveBeenCalledWith('valid-secret-token', {
      email: 'marites@example.edu',
      password: 'Password123!',
      password_confirmation: 'Password123!',
    }));
    expect(await screen.findByText('Staff home')).toBeInTheDocument();
  });

  it('greets office staff with their role and sends them to the staff home', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(staffInvite);
    mocks.acceptDepartmentHeadInvitation.mockResolvedValue({});
    mocks.login.mockResolvedValue({ data: { access_token: 't', user: { role: 'ADMIN' } } });
    renderPage();

    expect(await screen.findByRole('heading', { name: "You're invited to College of Arts and Sciences as office staff" })).toBeInTheDocument();
    expect(screen.getByText(/Your role: College Secretary/)).toBeInTheDocument();
    fillForm({ first: 'Clara', last: 'Cruz', schoolId: ' 20269999 ', email: 'clara@example.edu' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.acceptDepartmentHeadInvitation).toHaveBeenCalledWith('valid-secret-token', expect.objectContaining({ first_name: 'Clara', last_name: 'Cruz', school_id: 20269999 })));
    expect(await screen.findByText('Staff home')).toBeInTheDocument();
  });

  it('asks office staff from a bare link for their own name and School ID', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(staffInvite);
    renderPage();
    await screen.findByRole('heading', { name: /as office staff/ });

    [/^First name/, /^Last name/, /^School ID/].forEach((label) => {
      expect(screen.getByLabelText(label)).toHaveValue('');
      expect(screen.getByLabelText(label)).not.toHaveAttribute('readonly');
    });
    expect(screen.getByLabelText(/^Email/)).not.toHaveAttribute('readonly');
  });

  it('validates the form before sending anything', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const errorSummary = await screen.findByRole('group', { name: 'There is a problem' });
    ['Enter your first name.', 'Enter your last name.', 'Enter your school ID.', 'Enter your email.', 'Choose a password.'].forEach((message) => {
      expect(within(errorSummary).getByText(message)).toBeInTheDocument();
      expect(screen.getAllByText(message)).toHaveLength(2);
    });
    expect(errorSummary).toHaveFocus();
    expect(screen.getByLabelText(/^First name/)).toHaveAttribute('aria-invalid', 'true');

    fireEvent.click(within(errorSummary).getByText('Enter your first name.'));
    expect(screen.getByLabelText(/^First name/)).toHaveFocus();

    fillForm({ confirm: 'Mismatch!!' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await within(summary()).findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(screen.getAllByText('The two passwords do not match.')).toHaveLength(2);
    expect(mocks.acceptDepartmentHeadInvitation).not.toHaveBeenCalled();
  });

  it.each(['abc', '12 34', '123456789', '12.5', '-5'])('refuses the School ID %s before sending anything', async (typed) => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm({ schoolId: typed });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await within(await screen.findByRole('group', { name: 'There is a problem' })).findByText('Enter your school ID using numbers only.')).toBeInTheDocument();
    expect(mocks.acceptDepartmentHeadInvitation).not.toHaveBeenCalled();
  });

  it('shows a taken School ID under the field with the server sentence', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockRejectedValue({ response: { status: 422, data: { message: 'invalid', errors: { school_id: ['This school ID already has an account. Sign in, or reset your password.'] } } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await within(await screen.findByRole('group', { name: 'There is a problem' })).findByText('This school ID already has an account. Sign in, or reset your password.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^School ID/)).toHaveValue('20261234');
    expect(screen.getByLabelText(/^School ID/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows server field errors under the field and keeps what was typed', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockRejectedValue({ response: { status: 422, data: { message: 'invalid', errors: { email: ['The email has already been taken.'] } } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await within(await screen.findByRole('group', { name: 'There is a problem' })).findByText('The email has already been taken.')).toBeInTheDocument();
    expect(screen.getAllByText('The email has already been taken.')).toHaveLength(2);
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

    expect(await screen.findByText('This invitation link was already used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows a conflict from the server in the summary at the top of the form', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(deanInvite);
    mocks.acceptDepartmentHeadInvitation.mockRejectedValue({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
    renderPage();
    await screen.findByRole('heading', { name: /You're invited to lead/ });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await within(await screen.findByRole('group', { name: 'There is a problem' })).findByText(/This college already has an active Department Head\./)).toBeInTheDocument();
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

  it('asks an employee who already has an account to sign in instead of making a second one', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(existingInvite);
    renderPage();

    expect(await screen.findByText(/who already has an account. Sign in with it/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lets the signed-in employee accept, switches to the new office profile and lands on the staff home', async () => {
    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('user', JSON.stringify({ school_id: 7100101, role: 'ADMIN' }));
    mocks.getDepartmentHeadInvitation.mockResolvedValue(existingInvite);
    mocks.claimStaffInvitation.mockResolvedValue({ profile_id: 44 });
    mocks.switchAccountProfile.mockResolvedValue({ data: { user: { school_id: 7100101, role: 'ADMIN', organization: { organization_type: 'COLLEGE' } } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => expect(mocks.claimStaffInvitation).toHaveBeenCalledWith('valid-secret-token'));
    expect(mocks.switchAccountProfile).toHaveBeenCalledWith(44);
    expect(await screen.findByText('Staff home')).toBeInTheDocument();
  });

  it('fills in and locks the email the dean typed for someone who is not in the records', async () => {
    mocks.getDepartmentHeadInvitation.mockResolvedValue(prefilledInvite);
    renderPage();

    expect(await screen.findByLabelText(/^Email/)).toHaveValue('ramon@example.edu');
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/First name/)).toHaveValue('');
    expect(screen.getByLabelText(/Last name/)).toHaveValue('');
    expect(screen.getByLabelText(/^School ID/)).toHaveValue('');
  });
});
