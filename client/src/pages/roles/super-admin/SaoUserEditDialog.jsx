import { useState } from 'react';
import Modal from '../../../components/Modal';
import { Button, Field, Input } from '../../../components/ui';
import { updateSystemUser } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The SAO fixes a misspelt name or a wrong email. A password is never set here; a reset link is the way for that.
export default function SaoUserEditDialog({ user, onClose, onSaved }) {
  const [values, setValues] = useState({ first_name: user.first_name || '', last_name: user.last_name || '', email: user.email || '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const change = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    const payload = { first_name: values.first_name.trim(), last_name: values.last_name.trim(), email: values.email.trim().toLowerCase() };
    const problems = {};
    if (!payload.first_name) problems.first_name = 'Enter a first name.';
    if (!payload.last_name) problems.last_name = 'Enter a last name.';
    if (!EMAIL_PATTERN.test(payload.email)) problems.email = 'Enter a valid email address.';
    setErrors(problems);
    setError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await updateSystemUser(user.school_id, payload);
      onSaved({ ...user, ...payload });
    } catch (cause) {
      const fields = cause.response?.data?.errors || {};
      const mapped = Object.fromEntries(['first_name', 'last_name', 'email'].filter((key) => fields[key]?.[0]).map((key) => [key, fields[key][0]]));
      if (Object.keys(mapped).length) setErrors(mapped);
      else setError(getApiErrorMessage(cause, 'Could not save these details. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Edit details"
      description="Fix a misspelt name or a wrong email. If the email changes, the person is signed out and uses the new one next time."
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={false}
      maxWidth="max-w-lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="edit-user-form" loading={busy}>Save</Button>
        </>
      )}
    >
      <form id="edit-user-form" onSubmit={save} noValidate className="flex flex-col gap-4">
        <Field label="First name" error={errors.first_name}><Input value={values.first_name} onChange={change('first_name')} autoComplete="off" /></Field>
        <Field label="Last name" error={errors.last_name}><Input value={values.last_name} onChange={change('last_name')} autoComplete="off" /></Field>
        <Field label="Email" error={errors.email}><Input type="email" value={values.email} onChange={change('email')} autoComplete="off" /></Field>
        {error && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
      </form>
    </Modal>
  );
}
