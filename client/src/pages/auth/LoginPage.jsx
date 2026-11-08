import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import PasswordField from '../../components/auth/PasswordField';
import { Button } from '../../components/ui';
import { login } from '../../services/authService';
import { startAuthSession } from '../../utils/authSession';

const ROLE_REDIRECTS = {
  SUPER_ADMIN: '/dashboard/super-admin',
  ADMIN: '/dashboard/admin',
  SBO_OFFICER: '/dashboard/officer',
  DEPARTMENT_HEAD: '/dashboard/department-head',
  STUDENT: '/dashboard/student',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const credentials = {
      identifier: identifier.trim(),
      password,
    };

    try {
      const response = await login(credentials);
      startAuthSession(response.data);

      if (response.data.user?.must_change_password) {
        navigate('/change-password', { replace: true });
        return;
      }

      const role = response.data.user?.role;
      navigate(ROLE_REDIRECTS[role] || '/dashboard');
    } catch (err) {
      const status = err.response?.status;

      if (status === 403) {
        setError(err.response?.data?.message || 'This account cannot sign in right now. Contact your organization admin for help.');
      } else if (status === 422) {
        const msgs = err.response?.data?.errors;
        const first = msgs ? Object.values(msgs).flat()[0] : null;
        setError(first || 'Enter your email or school ID and your password to continue.');
      } else if (status === 429) {
        setError(err.response?.data?.message || 'Too many attempts. Wait a moment, then try again.');
      } else {
        setError('That email or school ID and password did not match. Check both and try again, or reset your password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">Sign in</h1>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <AuthField
          label="Email or school ID"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="you@school.edu or 2100142"
          required
        />

        <PasswordField
          label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
          required
        />

        {error && (
          <p role="alert" className="rounded-control border border-danger-strong/30 bg-danger-tint px-3 py-2.5 text-sm font-medium text-danger-strong">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end text-sm">
          <Link to="/recover-account" className="inline-flex min-h-11 items-center font-medium text-brand-700 underline hover:text-brand-800">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
        New student? <Link to="/sign-up" className="font-medium text-brand-700 underline hover:text-brand-800">Create your account</Link>
      </p>
    </AuthLayout>
  );
}
