import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import ErrorSummary from '../../components/auth/ErrorSummary';
import PasswordField from '../../components/auth/PasswordField';
import { Button } from '../../components/ui';
import { lookupStudentRecord, register } from '../../services/authService';
import { startAuthSession } from '../../utils/authSession';
import { getApiErrorMessage } from '../../utils/apiError';

const FIELD_KEYS = ['school_id', 'birth_date', 'email', 'password', 'password_confirmation'];
const FIELD_IDS = Object.fromEntries(FIELD_KEYS.map((key) => [key, `sign-up-${key}`]));

const fieldErrors = (error) => Object.fromEntries(
  Object.entries(error?.response?.data?.errors || {}).map(([key, messages]) => [key, [].concat(messages)[0]]),
);

const today = () => new Date().toISOString().slice(0, 10);

export default function StudentSignUpPage() {
  const navigate = useNavigate();
  const [schoolId, setSchoolId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const failed = (error, fallback) => {
    const byField = fieldErrors(error);
    const known = Object.fromEntries(Object.entries(byField).filter(([key]) => FIELD_KEYS.includes(key)));
    setErrors(known);
    setFormError(Object.keys(known).length ? '' : getApiErrorMessage(error, fallback));
    setAttempt((count) => count + 1);
  };

  // Typing in a field clears only that field's message; everything typed is kept.
  const bind = (key, setter) => (event) => {
    setter(event.target.value);
    setErrors((existing) => ({ ...existing, [key]: undefined }));
  };

  async function createAccount(event) {
    event.preventDefault();
    const next = {};
    if (!/^\d{1,8}$/.test(schoolId.trim())) next.school_id = 'Enter your school ID using numbers only.';
    if (!birthDate) next.birth_date = 'Enter your birth date.';
    if (!email.trim()) next.email = 'Enter your email.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    if (!confirmation) next.password_confirmation = 'Type the password again.';
    else if (password !== confirmation) next.password_confirmation = 'The two passwords do not match.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) {
      setAttempt((count) => count + 1);
      return;
    }

    setLoading(true);
    const credentials = { school_id: Number(schoolId.trim()), birth_date: birthDate };
    try {
      const record = await lookupStudentRecord(credentials);
      const response = await register({
        ...credentials,
        email: email.trim(),
        password,
        password_confirmation: confirmation,
      });
      setCreated({ record: record.data, session: response.data });
    } catch (error) {
      failed(error, 'We could not create your account. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  function openDashboard() {
    startAuthSession(created.session);
    navigate('/dashboard/student', { replace: true });
  }

  if (created) {
    const { record } = created;
    const details = [record.college, record.program, record.year_level].filter(Boolean).join(', ');
    return (
      <AuthLayout>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Your account is ready</h1>
        <section aria-label="Your school record" className="mt-4 border-y border-line py-3">
          <p className="text-sm font-semibold text-ink">{record.name}</p>
          {details && <p className="text-sm text-ink-muted">{details}</p>}
          <p className="mt-1 text-sm text-ink-muted">School ID {schoolId.trim()}</p>
        </section>
        <h2 className="mt-4 text-sm font-semibold text-ink">What happens next</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Sign in with {email.trim()} or your school ID.</li>
          <li>You cannot apply yet. Ask your Department Head to allow you.</li>
        </ul>
        <Button onClick={openDashboard} className="mt-6 w-full">Open my dashboard</Button>
      </AuthLayout>
    );
  }

  const summaryItems = [
    ...FIELD_KEYS.filter((key) => errors[key]).map((key) => ({ fieldId: FIELD_IDS[key], message: errors[key] })),
    ...(formError ? [{ message: formError }] : []),
  ];

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">Create your student account</h1>
      <p className="mt-2 text-sm text-ink-muted">Your name and program come from the school records, matched by your school ID and birth date.</p>

      <form className="mt-6 space-y-4" onSubmit={createAccount} noValidate>
        <ErrorSummary items={summaryItems} attempt={attempt} />
        <AuthField
          id={FIELD_IDS.school_id}
          label="School ID"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={schoolId}
          onChange={bind('school_id', setSchoolId)}
          error={errors.school_id}
          required
        />
        <AuthField
          id={FIELD_IDS.birth_date}
          label="Birth date"
          type="date"
          max={today()}
          min="1920-01-01"
          value={birthDate}
          onChange={bind('birth_date', setBirthDate)}
          error={errors.birth_date}
          required
        />
        <AuthField
          id={FIELD_IDS.email}
          label="Email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={bind('email', setEmail)}
          error={errors.email}
          hint="You will use this to sign in and to reset your password."
          required
        />
        <PasswordField
          id={FIELD_IDS.password}
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={bind('password', setPassword)}
          error={errors.password}
          hint="At least 8 characters."
          required
        />
        <PasswordField
          id={FIELD_IDS.password_confirmation}
          label="Confirm password"
          autoComplete="new-password"
          value={confirmation}
          onChange={bind('password_confirmation', setConfirmation)}
          error={errors.password_confirmation}
          required
        />
        <Button type="submit" loading={loading} className="w-full">Create account</Button>
      </form>

      <p className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
        Already have an account? <Link to="/login" className="font-medium text-brand-700 underline hover:text-brand-800">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
