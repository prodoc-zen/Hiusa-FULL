import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import ErrorSummary from '../../components/auth/ErrorSummary';
import PasswordField from '../../components/auth/PasswordField';
import { Button, ErrorState, Skeleton } from '../../components/ui';
import { acceptDepartmentHeadInvitation, claimStaffInvitation, getDepartmentHeadInvitation } from '../../services/systemAdministrationService';
import { login, switchAccountProfile } from '../../services/authService';
import { storedUser } from '../../utils/collegeIdentity';
import { startAuthSession } from '../../utils/authSession';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText.js';
import { INTERNAL_ID_START } from '../../utils/schoolId';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY = { first_name: '', last_name: '', school_id: '', email: '', password: '', password_confirmation: '' };
const FIELD_KEYS = Object.keys(EMPTY);
const FIELD_IDS = Object.fromEntries(FIELD_KEYS.map((key) => [key, `invite-${key}`]));

// A dean and SAO staff are invited by someone at the Student Affairs Office, office staff by their Department Head.
// The server sends the inviter's name only; without it the page names the office.
function invitedLine(invitation, college) {
  const name = invitation?.inviter?.name?.trim();
  if (invitation?.role === 'SAO_STAFF') return name ? `${name} from the Student Affairs Office invited you.` : 'Invited by the Student Affairs Office.';
  const staff = invitation?.role === 'COLLEGE_STAFF';
  if (!name) return `Invited by ${staff ? `the Department Head of ${college}` : 'the Student Affairs Office'}.`;
  return staff ? `${name}, the Department Head, invited you to ${college}.` : `${name} from the Student Affairs Office invited you to ${college}.`;
}

const INVALID_COPY = {
  expired: { title: 'This invitation link has expired', description: 'Ask the office that sent it for a new one.' },
  used: { title: 'This invitation link was already used', description: 'Sign in with the account you made.' },
  incomplete: { title: 'This invitation link is incomplete', description: 'Open the link exactly as it was sent, or ask the office that sent it for a new one.' },
};

const invalidKind = (cause) => (/already used/i.test(cause?.response?.data?.message || '') ? 'used' : 'expired');

const ROLE_HOME = {
  SUPER_ADMIN: '/dashboard/super-admin',
  DEPARTMENT_HEAD: '/dashboard/department-head',
  ADMIN: '/dashboard/admin',
};

function headline(invitation, college) {
  if (invitation?.role === 'SAO_STAFF') return "You're invited to the Student Affairs Office as SAO staff";
  if (invitation?.role === 'COLLEGE_STAFF') return `You're invited to ${college} as office staff`;
  return `You're invited to lead ${college}`;
}

function validate(values, fromRecord) {
  const found = {};
  if (!fromRecord && !values.first_name.trim()) found.first_name = 'Enter your first name.';
  if (!fromRecord && !values.last_name.trim()) found.last_name = 'Enter your last name.';
  const schoolId = values.school_id.trim();
  if (!fromRecord && !schoolId) found.school_id = 'Enter your school ID.';
  else if (!fromRecord && !/^\d{1,8}$/.test(schoolId)) found.school_id = 'Enter your school ID using numbers only.';
  else if (!fromRecord && Number(schoolId) >= INTERNAL_ID_START) found.school_id = 'That school ID cannot be used. Check the number the school gave you.';
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
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();

  const [state, setState] = useState(token ? 'loading' : 'invalid');
  const [loadError, setLoadError] = useState('');
  const [invalidReason, setInvalidReason] = useState(token ? 'expired' : 'incomplete');
  const [invite, setInvite] = useState(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [submits, setSubmits] = useState(0);

  useEffect(() => {
    if (!token) return undefined;
    let current = true;
    setState('loading');
    getDepartmentHeadInvitation(token)
      .then((data) => {
        if (!current) return;
        setInvite(data);
        if (data.invitation?.prefill) {
          const { first_name: first, last_name: last, email } = data.invitation.prefill;
          setValues((existing) => ({ ...existing, first_name: first || '', last_name: last || '', email: email || '' }));
        }
        setState('ready');
      })
      .catch((cause) => {
        if (!current) return;
        setLoadError(getApiErrorMessage(cause, 'The invitation could not be loaded. Try again.'));
        setInvalidReason(invalidKind(cause));
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
    const found = validate(values, Boolean(record));
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) {
      setSubmits((count) => count + 1);
      return;
    }

    setSubmitting(true);
    const email = values.email.trim().toLowerCase();
    try {
      const body = {
        ...(!record && { first_name: values.first_name.trim(), last_name: values.last_name.trim(), school_id: Number(values.school_id.trim()) }),
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
      setSubmits((count) => count + 1);
      if (!Object.keys(mapped).length) {
        const status = cause.response?.status;
        if (status === 404 || status === 410) {
          setInvalidReason(invalidKind(cause));
          setState('invalid');
        } else {
          setFormError(getApiErrorMessage(cause, 'We could not create your account. Try again.'));
        }
      }
      setSubmitting(false);
    }
  }

  async function handleClaim() {
    setSubmitting(true);
    setFormError('');
    try {
      const claimed = await claimStaffInvitation(token);
      const switched = await switchAccountProfile(claimed.profile_id);
      localStorage.setItem('user', JSON.stringify(switched.data.user));
      navigate(ROLE_HOME[switched.data.user?.role] || '/dashboard', { replace: true });
    } catch (cause) {
      const status = cause.response?.status;
      if (status === 404 || status === 410) {
        setInvalidReason(invalidKind(cause));
        setState('invalid');
      } else {
        setFormError(getApiErrorMessage(cause, 'We could not accept this invitation. Try again.'));
      }
      setSubmitting(false);
    }
  }

  const record = invite?.invitation?.record || null;
  const lockedEmail = Boolean(invite?.invitation?.prefill?.email);
  const existingAccount = Boolean(invite?.invitation?.existing_account);
  const signedInAsRecord = existingAccount && Boolean(localStorage.getItem('auth_token')) && Number(storedUser()?.school_id) === Number(record?.school_id);
  const summaryItems = [
    ...FIELD_KEYS.filter((key) => errors[key]).map((key) => ({ fieldId: FIELD_IDS[key], message: errors[key] })),
    ...(formError ? [{ message: formError }] : []),
  ];
  const college = invite?.college?.name ? formatDisplayText(invite.college.name) : 'your college';

  return (
    <AuthLayout>
      {state === 'loading' && <InviteSkeleton />}

      {state === 'invalid' && (
        <div>
          <ErrorState pageHeading title={INVALID_COPY[invalidReason].title} description={INVALID_COPY[invalidReason].description} className="py-0" />
          {invalidReason === 'used' && (
            <p className="mt-4 text-sm">
              <Link to="/login" className="font-medium text-brand-700 underline hover:text-brand-800">Sign in</Link>
            </p>
          )}
        </div>
      )}

      {state === 'failed' && <ErrorState pageHeading title="We could not open this invitation" description={loadError} onRetry={() => setAttempt((count) => count + 1)} className="py-0" />}

      {state === 'ready' && (
        <>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">{headline(invite.invitation, college)}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {invitedLine(invite.invitation, college)}
            {invite.invitation?.role === 'COLLEGE_STAFF' && invite.invitation?.position_title ? ` Your role: ${invite.invitation.position_title}.` : ''}
            {record ? ' Your name and School ID come from the school records.' : ''}
          </p>

          {existingAccount ? (
            <div className="mt-6 space-y-4">
              {signedInAsRecord ? (
                <>
                  <ErrorSummary items={formError ? [{ message: formError }] : []} attempt={submits} />
                  <p className="text-sm text-ink-muted">Accepting adds this role to your account.</p>
                  <Button onClick={handleClaim} loading={submitting} className="w-full">Accept invitation</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-muted">
                    This invitation is for {record ? `${record.first_name} ${record.last_name}` : 'someone'}, who already has an account. Sign in with it, then open this link again.
                  </p>
                  <Link to="/login" className="inline-block font-medium text-brand-700 underline hover:text-brand-800">Sign in</Link>
                </>
              )}
            </div>
          ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <ErrorSummary items={summaryItems} attempt={submits} />
            {record ? (
              <>
                <AuthField label="Name" value={`${record.first_name} ${record.last_name}`} readOnly />
                <AuthField label="School ID" value={String(record.school_id)} readOnly hint="Given by the school. It cannot be changed." />
              </>
            ) : (
              <>
                <AuthField id={FIELD_IDS.first_name} label="First name" autoComplete="given-name" value={values.first_name} error={errors.first_name} onChange={(event) => setField('first_name', event.target.value)} required />
                <AuthField id={FIELD_IDS.last_name} label="Last name" autoComplete="family-name" value={values.last_name} error={errors.last_name} onChange={(event) => setField('last_name', event.target.value)} required />
                <AuthField id={FIELD_IDS.school_id} label="School ID" inputMode="numeric" autoComplete="off" hint="Your employee number." value={values.school_id} error={errors.school_id} onChange={(event) => setField('school_id', event.target.value)} required />
              </>
            )}
            <AuthField id={FIELD_IDS.email} label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} readOnly={lockedEmail} hint={lockedEmail ? 'The invitation was made for this email.' : undefined} value={values.email} error={errors.email} onChange={(event) => setField('email', event.target.value)} required />
            <PasswordField id={FIELD_IDS.password} label="Password" autoComplete="new-password" value={values.password} error={errors.password} hint="At least 8 characters." onChange={(event) => setField('password', event.target.value)} required />
            <PasswordField id={FIELD_IDS.password_confirmation} label="Confirm password" autoComplete="new-password" value={values.password_confirmation} error={errors.password_confirmation} onChange={(event) => setField('password_confirmation', event.target.value)} required />

            <Button type="submit" loading={submitting} className="w-full">Create account</Button>
          </form>
          )}

          {!existingAccount && (
            <p className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
              Already have an account? <Link to="/login" className="font-medium text-brand-700 underline hover:text-brand-800">Sign in</Link>
            </p>
          )}
        </>
      )}
    </AuthLayout>
  );
}
