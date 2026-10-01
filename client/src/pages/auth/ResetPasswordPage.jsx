import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import PasswordField from '../../components/auth/PasswordField';
import { Button, DrawnCheck, ErrorState, SkeletonText } from '../../components/ui';
import { resetPassword, validatePasswordResetToken } from '../../services/authService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [success, setSuccess] = useState('');

  const resetPayload = useMemo(() => ({
    organization_id: searchParams.get('organization_id') || '',
    email: searchParams.get('email') || '',
    token: searchParams.get('token') || '',
  }), [searchParams]);

  useEffect(() => {
    let alive = true;

    async function validateToken() {
      setCheckingToken(true);
      setError('');

      try {
        await validatePasswordResetToken(resetPayload);
        if (alive) {
          setTokenValid(true);
        }
      } catch (err) {
        if (alive) {
          setTokenValid(false);
          setError(err.response?.data?.message || 'This reset link is invalid or has expired.');
        }
      } finally {
        if (alive) {
          setCheckingToken(false);
        }
      }
    }

    if (!resetPayload.organization_id || !resetPayload.email || !resetPayload.token) {
      setCheckingToken(false);
      setError('This reset link is missing information it needs. Request a new one below.');
      return;
    }

    validateToken();

    return () => {
      alive = false;
    };
  }, [resetPayload]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setConfirmError('');

    if (password !== passwordConfirmation) {
      setConfirmError('Passwords do not match.');
      return;
    }

    setSaving(true);

    try {
      const response = await resetPassword({
        ...resetPayload,
        password,
        password_confirmation: passwordConfirmation,
      });

      setSuccess(response.data?.message || 'Password updated successfully.');
      setTokenValid(false);
      window.setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to update password. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <DrawnCheck label="Password updated" size="lg" />
          <h1 className="mt-5 text-2xl font-black text-ink">Password updated</h1>
          <p className="mt-2 text-sm font-medium leading-6 text-ink-muted">{success}</p>
          <p className="mt-1 text-xs font-semibold text-ink-soft">Taking you to sign in with your new password.</p>
          <Button className="mt-6 w-full" onClick={() => navigate('/login', { replace: true })}>
            Back to login now
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-black text-ink">Create a new password</h1>
      <p className="mt-2 text-sm font-medium leading-6 text-ink-muted">
        Use at least 8 characters. After the update, any existing sessions for this account are signed out.
      </p>

      {checkingToken && (
        <div className="mt-6">
          <p className="text-sm font-semibold text-ink-muted">Validating your reset link&hellip;</p>
          <div className="mt-4"><SkeletonText lines={3} /></div>
        </div>
      )}

      {!checkingToken && !tokenValid && (
        <ErrorState
          className="mt-6 px-0 py-8"
          title="This reset link isn't valid"
          description={error}
          onRetry={() => navigate('/recover-account')}
          retryLabel="Request a new link"
        />
      )}

      {tokenValid && (
        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <PasswordField
            label="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter new password"
            autoComplete="new-password"
            minLength={8}
            required
          />

          <PasswordField
            label="Confirm new password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            minLength={8}
            required
            error={confirmError}
          />

          {error && (
            <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-xs font-semibold text-danger-strong">
              {error}
            </p>
          )}

          <Button type="submit" loading={saving} className="w-full">
            Update password
          </Button>
        </form>
      )}

      <Link to="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-navy-950">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to login
      </Link>
    </AuthLayout>
  );
}
