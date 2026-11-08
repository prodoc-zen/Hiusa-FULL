import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, UserRound } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import { Button, DrawnCheck } from '../../components/ui';
import { requestPasswordReset } from '../../services/authService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function RecoverAccountPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await requestPasswordReset({ identifier: identifier.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to send reset instructions. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <DrawnCheck label="Reset email sent" size="lg" />
          <h1 className="mt-5 text-2xl font-black text-ink">Check your email</h1>
          <p className="mt-2 max-w-[320px] text-sm font-medium leading-6 text-ink-muted">
            If an account matches <span className="font-bold text-ink">{identifier.trim()}</span>, we sent reset instructions to the email address on it.
          </p>

          <div className="mt-5 w-full space-y-2 rounded-control border border-line bg-subtle p-4 text-left text-xs font-semibold leading-5 text-ink-muted">
            <p>Open the inbox for that address and look for an email from HIUSA.</p>
            <p>The reset link stays valid for a limited time. If it expires, request a new one from this page.</p>
            <p>Nothing arrived? Check spam, or make sure you typed the email or school ID you sign in with.</p>
          </div>

          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row">
            <Button variant="secondary" className="flex-1" onClick={() => setSubmitted(false)}>
              Send another email
            </Button>
            <Button className="flex-1" onClick={() => navigate('/login')}>
              Back to login
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-black text-ink">Reset your password</h1>
      <p className="mt-2 text-sm font-medium leading-6 text-ink-muted">
        Enter the email or school ID you sign in with. We will send a reset link to the email address on your account.
      </p>

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

        {error && (
          <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-xs font-semibold text-danger-strong">
            {error}
          </p>
        )}

        <Button type="submit" loading={loading} rightIcon={Send} className="w-full">
          Send reset link
        </Button>
      </form>

      <Link to="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-navy-950">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to login
      </Link>
    </AuthLayout>
  );
}
