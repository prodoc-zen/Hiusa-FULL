import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import PasswordField from '../../components/auth/PasswordField';
import { Button, ErrorState, Skeleton } from '../../components/ui';
import { acceptDepartmentHeadInvitation, getDepartmentHeadInvitation } from '../../services/systemAdministrationService';
import { login } from '../../services/authService';
import { startAuthSession } from '../../utils/authSession';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY = { first_name: '', last_name: '', email: '', password: '', password_confirmation: '' };
const FIELD_KEYS = Object.keys(EMPTY);

const ROLE_HOME = {
  DEPARTMENT_HEAD: '/dashboard/department-head',
  ADMIN: '/dashboard/admin',
};

function headline(invitation, college) {
  if (invitation?.role === 'COLLEGE_STAFF') return `You're invited to ${college} as office staff`;
  return `You're invited to lead ${college}`;
}

function validate(values) {
  const found = {};
  if (!values.first_name.trim()) found.first_name = 'Enter your first name.';
  if (!values.last_name.trim()) found.last_name = 'Enter your last name.';
  const email = values.email.trim();
  if (!email) found.email = 'Enter your email.';
  else if (!EMAIL_PATTERN.test(email)) found.email = 'That email does not look right.';
  if (!values.password) found.password = 'Choose a password.';
  else if (values.password.length < 8) found.password = 'Use at least 8 characters.';
  if (!values.password_confirmation) found.password_confirmation = 'Type the password again.';
  else if (values.password !== values.password_confirmation) found.password_confirmation = 'The two passwords do not match.';
  return found;
}

function InviteSkeleton() {
  return (
    <div role="status" aria-label="Loading invitation" aria-busy="true" className="space-y-4">
      <Skeleton className="h-8 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();

  const [state, setState] = useState(token ? 'loading' : 'invalid');
  const [loadError, setLoadError] = useState(token ? '' : 'This link is missing its code. Open the link exactly as it was sent to you.');
  const [invite, setInvite] = useState(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return undefined;
    let current = true;
    setState('loading');
    getDepartmentHeadInvitation(token)
      .then((data) => {
        if (!current) return;
        setInvite(data);
        setState('ready');
      })
      .catch((cause) => {
        if (!current) return;
        setLoadError(getApiErrorMessage(cause, 'This link does not work. Ask for a new one.'));
        setState(cause.response?.status >= 500 || !cause.response ? 'failed' : 'invalid');
      });
    return () => { current = false; };
  }, [token, attempt]);

  function setField(key, value) {
    setValues((existing) => ({ ...existing, [key]: value }));
    setErrors((existing) => ({ ...existing, [key]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;

    setSubmitting(true);
    const email = values.email.trim().toLowerCase();
    try {
      const body = {
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email,
        password: values.password,
        password_confirmation: values.password_confirmation,
      };
      await acceptDepartmentHeadInvitation(token, body);

      try {
        const response = await login({ identifier: email, password: values.password });
        startAuthSession(response.data);
        navigate(ROLE_HOME[response.data.user?.role] || '/dashboard', { replace: true });
      } catch {
        navigate('/login', { replace: true });
      }
    } catch (cause) {
      const fieldErrors = cause.response?.data?.errors || {};
      const mapped = Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => FIELD_KEYS.includes(key)).map(([key, messages]) => [key, [].concat(messages)[0]]));
      setErrors(mapped);
      if (!Object.keys(mapped).length) {
        const status = cause.response?.status;
        if (status === 404 || status === 410) {
          setLoadError(getApiErrorMessage(cause, 'This link does not work. Ask for a new one.'));
          setState('invalid');
        } else {
          setFormError(getApiErrorMessage(cause, 'We could not create your account. Try again.'));
        }
      }
      setSubmitting(false);
    }
  }

  const college = invite?.college?.name ? formatDisplayText(invite.college.name) : 'your college';

  return (
    <AuthLayout>
      {state === 'loading' && <InviteSkeleton />}

      {state === 'invalid' && (
        <div>
          <ErrorState title="This link does not work" description={loadError} className="px-0 py-4" />
          <p className="mt-2 text-center text-sm font-medium text-ink-muted">
            Already made your account? <Link to="/login" className="font-bold text-brand-700 hover:text-navy-950">Sign in</Link>
          </p>
        </div>
      )}

      {state === 'failed' && <ErrorState title="We could not open this link" description={loadError} onRetry={() => setAttempt((count) => count + 1)} className="px-0 py-4" />}

      {state === 'ready' && (
        <>
          <h1 className="text-[26px] font-extrabold leading-tight text-ink">{headline(invite.invitation, college)}</h1>
          <p className="mt-1.5 text-sm font-medium text-ink-muted">
            {invite.invitation?.role === 'COLLEGE_STAFF' && invite.invitation?.position_title ? `Your role: ${invite.invitation.position_title}. ` : ''}
            Fill in your details to create your account. You will sign in with your email.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <AuthField label="First name" autoComplete="given-name" value={values.first_name} error={errors.first_name} onChange={(event) => setField('first_name', event.target.value)} required />
            <AuthField label="Last name" autoComplete="family-name" value={values.last_name} error={errors.last_name} onChange={(event) => setField('last_name', event.target.value)} required />
            <AuthField label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={values.email} error={errors.email} onChange={(event) => setField('email', event.target.value)} required />
            <PasswordField label="Password" autoComplete="new-password" value={values.password} error={errors.password} hint="At least 8 characters." onChange={(event) => setField('password', event.target.value)} required />
            <PasswordField label="Confirm password" autoComplete="new-password" value={values.password_confirmation} error={errors.password_confirmation} onChange={(event) => setField('password_confirmation', event.target.value)} required />

            {formError && (
              <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-xs font-semibold text-danger-strong">{formError}</p>
            )}

            <Button type="submit" loading={submitting} className="w-full">Create account</Button>
          </form>

          <p className="mt-5 text-center text-sm font-medium text-ink-muted">
            Already have an account? <Link to="/login" className="font-bold text-brand-700 hover:text-navy-950">Sign in</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
