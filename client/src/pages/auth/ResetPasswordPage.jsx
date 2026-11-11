import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import PasswordField from '../../components/auth/PasswordField';
import { Button, ErrorState, SkeletonText } from '../../components/ui';
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
  const linkIsComplete = Boolean(resetPayload.organization_id && resetPayload.email && resetPayload.token);

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
          setError(err.response?.data?.message || 'Request a new link to choose a new password.');
        }
      } finally {
        if (alive) {
          setCheckingToken(false);
        }
      }
    }

    if (!linkIsComplete) {
      setCheckingToken(false);
      setError('This reset link is incomplete. Request a new one.');
      return;
    }

    validateToken();

    return () => {
      alive = false;
    };
  }, [resetPayload, linkIsComplete]);

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
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Password updated</h1>
        <p className="mt-2 text-sm text-ink-muted">{success}</p>
        <p className="mt-1 text-sm text-ink-muted">Taking you to sign in with your new password.</p>
        <Button className="mt-6 w-full" onClick={() => navigate('/login', { replace: true })}>
          Back to login now
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">Create a new password</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Use at least 8 characters. You are signed out of this account on every device.
      </p>

      {checkingToken && (
        <div className="mt-6">
          <p className="text-sm text-ink-muted">Checking your reset link</p>
          <div className="mt-4"><SkeletonText lines={3} /></div>
        </div>
      )}

      {!checkingToken && !tokenValid && (
        <ErrorState
          className="mt-6 py-0"
          title={linkIsComplete ? 'This reset link has expired' : 'This reset link is not valid'}
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
            <p role="alert" className="rounded-control border border-danger-strong/30 bg-danger-tint px-3 py-2.5 text-sm font-medium text-danger-strong">
              {error}
            </p>
          )}

          <Button type="submit" loading={saving} className="w-full">
            Update password
          </Button>
        </form>
      )}

      <Link to="/login" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline hover:text-brand-800">
        Back to login
      </Link>
    </AuthLayout>
  );
}
