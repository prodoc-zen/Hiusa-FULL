import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock('../../services/authService', () => authMocks);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard/student" element={<p>Student dashboard</p>} />
        <Route path="/change-password" element={<p>Change password page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authMocks.login.mockResolvedValue({
      data: {
        access_token: 'test-token',
        user: { school_id: 2100142, role: 'STUDENT' },
      },
    });
  });

  it('tells a replaced officer why they were signed out, once', () => {
    sessionStorage.setItem('sign_out_notice', 'Your officer access for Computer Society ended when the new officers took over.');
    const { unmount } = renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Your officer access for Computer Society ended when the new officers took over.');
    unmount();

    renderPage();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the reason the server gives an officer whose access ended', async () => {
    authMocks.login.mockRejectedValue({ response: { status: 403, data: { message: 'Your officer access for Computer Society ended when the new officers took over.' } } });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email or school ID'), { target: { value: '2100142' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'a-strong-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your officer access for Computer Society ended when the new officers took over.');
  });

  it('links new students to the sign-up page', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Create your account' })).toHaveAttribute('href', '/sign-up');
  });

  it('has one field that takes an email or a school ID', async () => {
    renderPage();

    const field = screen.getByLabelText('Email or school ID');
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);

    fireEvent.change(field, { target: { value: ' Dean.Reyes@School.edu ' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'a-strong-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authMocks.login).toHaveBeenCalledWith({
      identifier: 'Dean.Reyes@School.edu',
      password: 'a-strong-passphrase',
    }));
    expect(await screen.findByText('Student dashboard')).toBeInTheDocument();
    expect(Number(localStorage.getItem('auth_expires_at'))).toBeGreaterThan(Date.now());
  });

  it('still signs a student in with a school ID typed as is', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Email or school ID'), { target: { value: '2100142' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'a-strong-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authMocks.login).toHaveBeenCalledWith({ identifier: '2100142', password: 'a-strong-passphrase' }));
  });

  it('shows one plain message when the details do not match', async () => {
    authMocks.login.mockRejectedValue({ response: { status: 422, data: { errors: { identifier: ['The provided credentials are incorrect.'] } } } });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email or school ID'), { target: { value: 'nobody@school.edu' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'wrong-wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The provided credentials are incorrect.');
  });

  it('sends a user who must change a default password to the change password page instead of the dashboard', async () => {
    authMocks.login.mockResolvedValue({
      data: {
        access_token: 'test-token',
        user: { school_id: 2100142, role: 'STUDENT', must_change_password: true },
      },
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email or school ID'), { target: { value: '2100142' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: '0142-uclm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Change password page')).toBeInTheDocument();
    expect(screen.queryByText('Student dashboard')).not.toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('test-token');
  });
});
