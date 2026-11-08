import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, IdCard, Mail } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthField from '../../components/auth/AuthField';
import PasswordField from '../../components/auth/PasswordField';
import { Button } from '../../components/ui';
import { lookupStudentRecord, register } from '../../services/authService';
import { startAuthSession } from '../../utils/authSession';
import { getApiErrorMessage } from '../../utils/apiError';

const fieldErrors = (error) => Object.fromEntries(
  Object.entries(error?.response?.data?.errors || {}).map(([key, messages]) => [key, messages[0]]),
);

const today = () => new Date().toISOString().slice(0, 10);

export default function StudentSignUpPage() {
  const navigate = useNavigate();
  const accountSection = useRef(null);
  const [schoolId, setSchoolId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [match, setMatch] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  const failed = (error, fallback) => {
    const byField = fieldErrors(error);
    setErrors(byField);
    setFormError(Object.keys(byField).length ? '' : getApiErrorMessage(error, fallback));
  };

  async function findRecord(event) {
    event.preventDefault();
    const next = {};
    if (!/^\d{1,8}$/.test(schoolId.trim())) next.school_id = 'Enter your school ID using numbers only.';
    if (!birthDate) next.birth_date = 'Enter your birth date.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const response = await lookupStudentRecord({ school_id: Number(schoolId.trim()), birth_date: birthDate });
      setMatch(response.data);
      requestAnimationFrame(() => accountSection.current?.querySelector('input')?.focus());
    } catch (error) {
      failed(error, 'We could not check the school records. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    const next = {};
    if (!email.trim()) next.email = 'Enter your email.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    else if (password !== confirmation) next.password_confirmation = 'The two passwords do not match.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const response = await register({
        school_id: Number(schoolId.trim()),
        birth_date: birthDate,
        email: email.trim(),
        password,
        password_confirmation: confirmation,
      });
      startAuthSession(response.data);
      navigate('/dashboard/student', { replace: true });
    } catch (error) {
      const byField = fieldErrors(error);
      if (byField.school_id || byField.birth_date) setMatch(null);
      failed(error, 'We could not create your account. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  function changeRecord() {
    setMatch(null);
    setErrors({});
    setFormError('');
  }

  return (
    <AuthLayout>
      <Link to="/login" className="mb-4 inline-flex min-h-11 items-center text-sm font-bold text-brand-700 hover:text-navy-950">← Back to sign in</Link>
      <h1 className="text-[28px] font-extrabold leading-tight text-ink">Create your student account</h1>
      <p className="mt-1.5 text-sm font-medium text-ink-muted">We match your school ID and birth date with the school records, so you do not have to type your name or program.</p>

      {!match && (
        <form className="mt-6 space-y-4" onSubmit={findRecord} noValidate>
          <AuthField
            label="School ID"
            icon={IdCard}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={schoolId}
            onChange={(event) => setSchoolId(event.target.value)}
            error={errors.school_id}
            placeholder="2100142"
            required
          />
          <AuthField
            label="Birth date"
            type="date"
            max={today()}
            min="1920-01-01"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            error={errors.birth_date}
            required
          />
          {formError && <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-xs font-semibold text-danger-strong">{formError}</p>}
          <Button type="submit" loading={loading} rightIcon={ArrowRight} className="w-full">Find my record</Button>
        </form>
      )}

      {match && (
        <div className="mt-6 space-y-5">
          <section aria-label="Your school record" className="rounded-control border border-line bg-subtle px-4 py-3">
            <p className="text-xs font-semibold text-ink-muted">We found you</p>
            <p className="mt-0.5 text-base font-bold text-ink">{match.name}</p>
            <p className="text-sm font-medium text-ink-muted">{[match.college, match.program, match.year_level].filter(Boolean).join(', ')}</p>
            <button type="button" onClick={changeRecord} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-brand-700 hover:text-navy-950">
              Not you? Check your school ID
            </button>
          </section>

          <form ref={accountSection} className="space-y-4" onSubmit={createAccount} noValidate>
            <AuthField
              label="Email"
              icon={Mail}
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={errors.email}
              hint="You will use this to sign in and to reset your password."
              required
            />
            <PasswordField
              label="Password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
              hint="At least 8 characters."
              required
            />
            <PasswordField
              label="Confirm password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              error={errors.password_confirmation}
              required
            />
            {formError && <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-xs font-semibold text-danger-strong">{formError}</p>}
            <Button type="submit" loading={loading} rightIcon={ArrowRight} className="w-full">Create account</Button>
          </form>
        </div>
      )}

      <p className="mt-6 text-sm font-medium text-ink-muted">
        Already have an account? <Link to="/login" className="font-bold text-brand-700 hover:text-navy-950">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
