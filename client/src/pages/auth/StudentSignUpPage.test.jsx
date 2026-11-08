import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentSignUpPage from './StudentSignUpPage';

const authMocks = vi.hoisted(() => ({
  lookupStudentRecord: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../../services/authService', () => authMocks);

const record = { name: 'Hannah Reyes', college: 'College of Computer Studies', program: 'BS Information Technology', year_level: '1st Year', section: 'A' };
const MISMATCH = "We couldn't match that school ID and birth date with the school records.";
const CLAIMED = 'This school ID already has an account. Sign in, or reset your password.';

const apiError = (status, errors, message) => Object.assign(new Error('request failed'), { response: { status, data: { errors, message } } });
const summary = () => screen.findByRole('group', { name: 'There is a problem' });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sign-up']}>
      <Routes>
        <Route path="/sign-up" element={<StudentSignUpPage />} />
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/dashboard/student" element={<p>Student dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillForm({ birthDate = '2007-03-14', password = 'a-long-passphrase', confirmation = 'a-long-passphrase' } = {}) {
  fireEvent.change(screen.getByLabelText(/School ID/), { target: { value: '2600101' } });
  fireEvent.change(screen.getByLabelText(/Birth date/), { target: { value: birthDate } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'hannah@example.edu' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: confirmation } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

describe('StudentSignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authMocks.lookupStudentRecord.mockResolvedValue({ data: record });
    authMocks.register.mockResolvedValue({ data: { access_token: 'token', user: { school_id: 2600101, role: 'STUDENT' } } });
  });

  it('puts every field on one page with one button and never asks for names or a program', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Create your student account' })).toBeInTheDocument();
    [/School ID/, /Birth date/, /^Email/, /^Password/, /Confirm password/].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/First name|Last name|Program|Organization/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create account' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('checks every field on submit, lists the problems on top and beside each field, and calls nothing', async () => {
    renderPage();

    submit();

    const errorSummary = await summary();
    ['Enter your school ID using numbers only.', 'Enter your birth date.', 'Enter your email.', 'Use at least 8 characters.', 'Type the password again.'].forEach((message) => {
      expect(within(errorSummary).getByText(message)).toBeInTheDocument();
      expect(screen.getAllByText(message)).toHaveLength(2);
    });
    expect(errorSummary).toHaveFocus();
    expect(authMocks.lookupStudentRecord).not.toHaveBeenCalled();
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('keeps what was typed and flags a password that does not match', async () => {
    renderPage();
    fillForm({ confirmation: 'something-else' });

    submit();

    expect(await within(await summary()).findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText(/School ID/)).toHaveValue('2600101');
    expect(screen.getByLabelText(/^Email/)).toHaveValue('hannah@example.edu');
    expect(screen.getByLabelText(/^Password/)).toHaveValue('a-long-passphrase');
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('clears the message beside a field as soon as it is edited', async () => {
    renderPage();
    submit();
    await summary();

    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'hannah@example.edu' } });

    expect(screen.queryByText('Enter your email.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Enter your birth date.')).toHaveLength(2);
  });

  it('shows the server message beside the school ID when the record does not match', async () => {
    authMocks.lookupStudentRecord.mockRejectedValue(apiError(422, { school_id: [MISMATCH] }));
    renderPage();
    fillForm({ birthDate: '2000-01-01' });

    submit();

    expect(await within(await summary()).findByText(MISMATCH)).toBeInTheDocument();
    expect(screen.getAllByText(MISMATCH)).toHaveLength(2);
    expect(screen.getByLabelText(/School ID/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Birth date/)).toHaveValue('2000-01-01');
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('says so when the records cannot be reached', async () => {
    authMocks.lookupStudentRecord.mockRejectedValue(apiError(503, undefined, "The school records can't be reached right now. Please try again later."));
    renderPage();
    fillForm();

    submit();

    expect(await summary()).toHaveTextContent('This service is temporarily unavailable');
    expect(screen.getByLabelText(/School ID/)).toHaveValue('2600101');
  });

  it('checks the school record, then creates the account without names or an organization', async () => {
    renderPage();
    fillForm();

    submit();

    expect(await screen.findByRole('heading', { name: 'Your account is ready' })).toBeInTheDocument();
    expect(authMocks.lookupStudentRecord).toHaveBeenCalledWith({ school_id: 2600101, birth_date: '2007-03-14' });
    expect(authMocks.register).toHaveBeenCalledWith({
      school_id: 2600101,
      birth_date: '2007-03-14',
      email: 'hannah@example.edu',
      password: 'a-long-passphrase',
      password_confirmation: 'a-long-passphrase',
    });
  });

  it('ends on a confirmation that says who was matched and what happens next, then opens the dashboard', async () => {
    renderPage();
    fillForm();
    submit();

    expect(await screen.findByText('Hannah Reyes')).toBeInTheDocument();
    expect(screen.getByText('College of Computer Studies, BS Information Technology, 1st Year')).toBeInTheDocument();
    expect(screen.getByText('School ID 2600101')).toBeInTheDocument();
    expect(screen.getByText('What happens next')).toBeInTheDocument();
    expect(screen.getByText('You cannot apply yet. Ask your Department Head to allow you.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open my dashboard' }));

    expect(await screen.findByText('Student dashboard')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('token');
  });

  it('shows a taken email beside the email field and keeps everything typed', async () => {
    authMocks.register.mockRejectedValue(apiError(422, { email: ['The email has already been taken.'] }));
    renderPage();
    fillForm();

    submit();

    expect(await within(await summary()).findByText('The email has already been taken.')).toBeInTheDocument();
    expect(screen.getAllByText('The email has already been taken.')).toHaveLength(2);
    expect(screen.getByLabelText(/^Email/)).toHaveValue('hannah@example.edu');
    expect(screen.getByLabelText(/School ID/)).toHaveValue('2600101');
  });

  it('flags the school ID if the record was claimed meanwhile', async () => {
    authMocks.register.mockRejectedValue(apiError(422, { school_id: [CLAIMED] }));
    renderPage();
    fillForm();

    submit();

    await waitFor(() => expect(screen.getAllByText(CLAIMED)).toHaveLength(2));
    expect(screen.getByLabelText(/School ID/)).toHaveAttribute('aria-invalid', 'true');
  });
});
