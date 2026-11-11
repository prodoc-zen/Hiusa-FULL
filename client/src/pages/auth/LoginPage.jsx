import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, UserRound } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import PasswordField from '../../components/auth/PasswordField';
import { Button } from '../../components/ui';
import { login } from '../../services/authService';
import { startAuthSession, takeSignOutNotice } from '../../utils/authSession';

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
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const message = takeSignOutNotice();
    if (message) setNotice(message);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const credentials = {
      identifier: identifier.trim(),
      password,
    };

    if (!credentials.identifier || !credentials.password) {
      if (credentials.identifier) setError('Enter your password.');
      else setError(credentials.password ? 'Enter your email or school ID.' : 'Enter your email or school ID and your password.');
      return;
    }

    setLoading(true);

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
      } else if (status === 429) {
        setError(err.response?.data?.message || 'Too many attempts. Wait a moment, then try again.');
      } else if (!err.response) {
        setError('We could not reach HIUSA. Check your connection and try again.');
      } else if (status === 401 || status === 422) {
        setError('That email or school ID and password did not match. Check both and try again, or reset your password.');
      } else {
        setError('HIUSA had a problem signing you in. Try again in a moment.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Link to="/" className="mb-4 inline-flex min-h-11 items-center text-sm font-bold text-brand-700 hover:text-navy-950">← Back to HIUSA home</Link>
      <h1 className="text-[28px] font-extrabold leading-tight text-ink">Sign in to HIUSA</h1>
      <p className="mt-1.5 text-sm font-medium text-ink-muted">Use your email or school ID to open your workspace.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <AuthField
          label="Email or school ID"
          icon={UserRound}
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

        {notice && !error && (
          <p role="status" className="rounded-control border border-warning/40 bg-warning-tint px-3 py-2.5 text-xs font-semibold text-warning-strong">
            {notice}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-xs font-semibold text-danger-strong">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end text-sm">
          <Link to="/recover-account" className="font-bold text-brand-700 hover:text-navy-950">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={loading} rightIcon={ArrowRight} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-sm font-medium text-ink-muted">
        New student? <Link to="/sign-up" className="font-bold text-brand-700 hover:text-navy-950">Create your account</Link>
      </p>
    </AuthLayout>
  );
}
