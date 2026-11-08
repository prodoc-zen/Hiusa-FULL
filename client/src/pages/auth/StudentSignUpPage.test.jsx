import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function fillRecord(birthDate = '2007-03-14') {
  fireEvent.change(screen.getByLabelText(/School ID/), { target: { value: '2600101' } });
  fireEvent.change(screen.getByLabelText(/Birth date/), { target: { value: birthDate } });
  fireEvent.click(screen.getByRole('button', { name: /Find my record/ }));
}

async function findRecord() {
  fillRecord();
  await screen.findByText('Hannah Reyes');
}

function fillAccount() {
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'hannah@example.edu' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-passphrase' } });
  fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'a-long-passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: /Create account/ }));
}

describe('StudentSignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authMocks.lookupStudentRecord.mockResolvedValue({ data: record });
    authMocks.register.mockResolvedValue({ data: { access_token: 'token', user: { school_id: 2600101, role: 'STUDENT' } } });
  });

  it('asks only for a school ID and birth date first', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Create your student account' })).toBeInTheDocument();
    expect(screen.getByLabelText(/School ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Birth date/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/First name|Last name|Program|Organization/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('checks both fields before calling the server', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Find my record/ }));

    expect(await screen.findByText('Enter your school ID using numbers only.')).toBeInTheDocument();
    expect(screen.getByText('Enter your birth date.')).toBeInTheDocument();
    expect(authMocks.lookupStudentRecord).not.toHaveBeenCalled();
  });

  it('shows who was found, then asks for email and password', async () => {
    renderPage();
    await findRecord();

    expect(authMocks.lookupStudentRecord).toHaveBeenCalledWith({ school_id: 2600101, birth_date: '2007-03-14' });
    expect(screen.getByText('We found you')).toBeInTheDocument();
    expect(screen.getByText('College of Computer Studies, BS Information Technology, 1st Year')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm password/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/School ID/)).not.toBeInTheDocument();
  });

  it('shows the server message when the record does not match', async () => {
    authMocks.lookupStudentRecord.mockRejectedValue(apiError(422, { school_id: [MISMATCH] }));
    renderPage();

    fillRecord('2000-01-01');

    expect(await screen.findByText(MISMATCH)).toBeInTheDocument();
    expect(screen.queryByText('We found you')).not.toBeInTheDocument();
  });

  it('says so when the records cannot be reached', async () => {
    authMocks.lookupStudentRecord.mockRejectedValue(apiError(503, undefined, "The school records can't be reached right now. Please try again later."));
    renderPage();

    fillRecord();

    expect(await screen.findByRole('alert')).toHaveTextContent('This service is temporarily unavailable');
  });

  it('lets the student go back and fix the school ID', async () => {
    renderPage();
    await findRecord();

    fireEvent.click(screen.getByRole('button', { name: 'Not you? Check your school ID' }));

    expect(screen.getByLabelText(/School ID/)).toHaveValue('2600101');
    expect(screen.queryByText('We found you')).not.toBeInTheDocument();
  });

  it('checks the password before creating the account', async () => {
    renderPage();
    await findRecord();

    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'hannah@example.edu' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /Create account/ }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-passphrase' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'something-else' } });
    fireEvent.click(screen.getByRole('button', { name: /Create account/ }));
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('creates the account without sending names or an organization, then opens the student dashboard', async () => {
    renderPage();
    await findRecord();

    fillAccount();

    expect(await screen.findByText('Student dashboard')).toBeInTheDocument();
    expect(authMocks.register).toHaveBeenCalledWith({
      school_id: 2600101,
      birth_date: '2007-03-14',
      email: 'hannah@example.edu',
      password: 'a-long-passphrase',
      password_confirmation: 'a-long-passphrase',
    });
    expect(localStorage.getItem('auth_token')).toBe('token');
  });

  it('shows a taken email next to the email field and keeps the record', async () => {
    authMocks.register.mockRejectedValue(apiError(422, { email: ['The email has already been taken.'] }));
    renderPage();
    await findRecord();

    fillAccount();

    expect(await screen.findByText('The email has already been taken.')).toBeInTheDocument();
    expect(screen.getByText('We found you')).toBeInTheDocument();
  });

  it('sends the student back to the first step if the record was claimed meanwhile', async () => {
    authMocks.register.mockRejectedValue(apiError(422, { school_id: [CLAIMED] }));
    renderPage();
    await findRecord();

    fillAccount();

    await waitFor(() => expect(screen.getByText(CLAIMED)).toBeInTheDocument());
    expect(screen.getByLabelText(/School ID/)).toBeInTheDocument();
  });
});
