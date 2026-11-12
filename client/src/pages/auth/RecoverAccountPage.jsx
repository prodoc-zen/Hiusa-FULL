import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import { Button } from '../../components/ui';
import { requestPasswordReset } from '../../services/authService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function RecoverAccountPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [emailOff, setEmailOff] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await requestPasswordReset({ identifier: identifier.trim() });
      setEmailOff(response?.data?.email_sent === false);
      setSubmitted(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to send reset instructions. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted && emailOff) {
    return (
      <AuthLayout>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Ask for a reset</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Password reset by email is not available. Nothing was sent to anyone. Ask your organization Admin or the SAO for a one-time link to choose a new password, then open it to set one. SAO staff ask another SAO account holder.
        </p>

        <div className="mt-6">
          <Button className="w-full" onClick={() => navigate('/login')}>
            Back to login
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (submitted) {
    return (
      <AuthLayout>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">
          If an account matches <span className="font-semibold text-ink">{identifier.trim()}</span>, we sent reset instructions to the email address on it. Nothing arrived? Check spam, or send another email.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="flex-1" onClick={() => navigate('/login')}>
            Back to login
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => setSubmitted(false)}>
            Send another email
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Enter the email or school ID you sign in with. When email is turned on, we send a reset link to the email address on your account. When it is off, this page says so and you ask your organization Admin or the SAO for a one-time link. SAO staff ask another SAO account holder.
      </p>

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

        {error && (
          <p role="alert" className="rounded-control border border-danger-strong/30 bg-danger-tint px-3 py-2.5 text-sm font-medium text-danger-strong">
            {error}
          </p>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Request reset
        </Button>
      </form>

      <Link to="/login" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline hover:text-brand-800">
        Back to login
      </Link>
    </AuthLayout>
  );
}
