import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Hash } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import PasswordField from '../../components/auth/PasswordField';
import { Button } from '../../components/ui';
import { login } from '../../services/authService';

const ROLE_REDIRECTS = {
  SUPER_ADMIN: '/dashboard/super-admin',
  ADMIN: '/dashboard/admin',
  SBO_OFFICER: '/dashboard/officer',
  DEPARTMENT_HEAD: '/dashboard/department-head',
  STUDENT: '/dashboard/student',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [schoolId, setSchoolId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const credentials = {
      school_id: schoolId.trim(),
      password,
    };

    try {
      const response = await login(credentials);
      localStorage.setItem('auth_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      const role = response.data.user?.role;
      navigate(ROLE_REDIRECTS[role] || '/dashboard');
    } catch (err) {
      const status = err.response?.status;

      if (status === 403) {
        setError(err.response?.data?.message || 'This account cannot sign in right now. Contact your organization admin for help.');
      } else if (status === 422) {
        const msgs = err.response?.data?.errors;
        const first = msgs ? Object.values(msgs).flat()[0] : null;
        setError(first || 'Enter your school ID and password to continue.');
      } else if (status === 429) {
        setError(err.response?.data?.message || 'Too many attempts. Wait a moment, then try again.');
      } else {
        setError('That school ID and password did not match. Check both and try again, or reset your password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-[28px] font-extrabold leading-tight text-ink">Sign in to HIUSA</h1>
      <p className="mt-1.5 text-sm font-medium text-ink-muted">Use your school ID to open your organization workspace.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <AuthField
          label="School ID / ID Number"
          icon={Hash}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          autoComplete="username"
          value={schoolId}
          onChange={(event) => setSchoolId(event.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="Enter your school ID or ID number"
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
    </AuthLayout>
  );
}
