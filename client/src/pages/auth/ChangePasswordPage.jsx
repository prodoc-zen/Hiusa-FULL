import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import PasswordField from '../../components/auth/PasswordField';
import { Button } from '../../components/ui';
import { updatePassword } from '../../services/profileService';
import { getApiErrorMessage } from '../../utils/apiError';

const MIN_LENGTH = 8;
const FIELD_IDS = {
  current_password: 'change-password-current',
  password: 'change-password-new',
  password_confirmation: 'change-password-confirmation',
};
const FIELD_ORDER = ['current_password', 'password', 'password_confirmation'];

function clearStoredFlag() {
  try {
    const user = JSON.parse(localStorage.getItem('user')) || {};
    localStorage.setItem('user', JSON.stringify({ ...user, must_change_password: false }));
  } catch {
    localStorage.removeItem('user');
  }
}

function serverFieldErrors(error) {
  const errors = error.response?.data?.errors;
  const fields = {};

  if (errors) {
    FIELD_ORDER.forEach((field) => {
      if (errors[field]?.[0]) fields[field] = errors[field][0];
    });
    if (Object.keys(fields).length) return fields;
  }

  const message = getApiErrorMessage(error, 'Unable to save your new password. Try again.');
  fields[/current password/i.test(message) ? 'current_password' : 'password'] = message;

  return fields;
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ current_password: '', password: '', password_confirmation: '' });
  const [errors, setErrors] = useState({});
  const [focusRequest, setFocusRequest] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (focusRequest) document.getElementById(FIELD_IDS[focusRequest.field])?.focus();
  }, [focusRequest]);

  function showErrors(next) {
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    if (first) setFocusRequest({ field: first });
  }

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const invalid = {};
    if (!form.current_password) invalid.current_password = 'Enter your current password.';
    if (form.password.length < MIN_LENGTH) invalid.password = `Use at least ${MIN_LENGTH} characters.`;
    if (form.password_confirmation !== form.password) invalid.password_confirmation = 'The confirmation does not match.';
    if (Object.keys(invalid).length) {
      showErrors(invalid);
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      await updatePassword(form);
      clearStoredFlag();
      navigate('/dashboard', { replace: true });
    } catch (error) {
      showErrors(serverFieldErrors(error));
      setSaving(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-[28px] font-extrabold leading-tight text-ink">Choose a new password</h1>
      <p className="mt-1.5 text-sm font-medium text-ink-muted">
        Your account was created with a default password. Set your own before you continue.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <PasswordField
          id={FIELD_IDS.current_password}
          label="Current password"
          value={form.current_password}
          onChange={update('current_password')}
          autoComplete="current-password"
          error={errors.current_password}
          required
        />

        <PasswordField
          id={FIELD_IDS.password}
          label="New password"
          hint={`Use at least ${MIN_LENGTH} characters.`}
          value={form.password}
          onChange={update('password')}
          autoComplete="new-password"
          error={errors.password}
          required
        />

        <PasswordField
          id={FIELD_IDS.password_confirmation}
          label="Confirm new password"
          value={form.password_confirmation}
          onChange={update('password_confirmation')}
          autoComplete="new-password"
          error={errors.password_confirmation}
          required
        />

        <Button type="submit" loading={saving} className="w-full">
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}
