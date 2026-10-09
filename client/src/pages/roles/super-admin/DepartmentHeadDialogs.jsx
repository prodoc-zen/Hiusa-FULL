import { useEffect, useRef, useState } from 'react';
import { KeyRound, UserCheck, UserX } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import { Button, Field, Input, StatusBadge } from '../../../components/ui';
import { createDepartmentHead, resetDepartmentHeadPassword, updateDepartmentHead } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDisplayText } from '../../../utils/displayText.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSIGN_FIELDS = ['school_id', 'first_name', 'last_name', 'email', 'password', 'password_confirmation'];
const EMPTY_ASSIGNMENT = { school_id: '', first_name: '', last_name: '', email: '', password: '', password_confirmation: '' };

export function summarizeHead(user) {
  return {
    school_id: user.school_id,
    name: `${user.first_name} ${user.last_name}`.trim(),
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    account_status: user.account_status,
  };
}

function serverFieldErrors(cause) {
  return Object.fromEntries(Object.entries(cause?.response?.data?.errors || {}).map(([key, messages]) => [key, [].concat(messages)[0]]));
}

function validateIdentity(values, { requireSchoolId }) {
  const found = {};
  if (requireSchoolId) {
    const schoolId = values.school_id.trim();
    if (!schoolId) found.school_id = 'Enter the School ID.';
    else if (!/^\d{1,8}$/.test(schoolId) || Number(schoolId) < 1) found.school_id = 'Use a School ID of up to 8 digits.';
  }
  if (!values.first_name.trim()) found.first_name = 'Enter the first name.';
  else if (values.first_name.trim().length > 60) found.first_name = 'The first name may not be longer than 60 characters.';
  if (!values.last_name.trim()) found.last_name = 'Enter the last name.';
  else if (values.last_name.trim().length > 60) found.last_name = 'The last name may not be longer than 60 characters.';
  const email = values.email.trim();
  if (!email) found.email = 'Enter the email address.';
  else if (!EMAIL_PATTERN.test(email)) found.email = 'Enter a valid email address.';
  else if (email.length > 100) found.email = 'The email may not be longer than 100 characters.';
  return found;
}

function useFirstInvalidFocus(formRef) {
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (request > 0) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [request, formRef]);
  return () => setRequest((count) => count + 1);
}

export function AssignDepartmentHeadModal({ college, onClose, onAssigned }) {
  const [values, setValues] = useState(EMPTY_ASSIGNMENT);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);
  const focusFirstInvalid = useFirstInvalidFocus(formRef);
  const collegeName = formatDisplayText(college.name);

  function setField(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    const found = validateIdentity(values, { requireSchoolId: true });
    if (!values.password) found.password = 'Enter an initial password.';
    else if (values.password.length < 8) found.password = 'Use at least 8 characters.';
    if (!values.password_confirmation) found.password_confirmation = 'Enter the password again.';
    else if (values.password !== values.password_confirmation) found.password_confirmation = 'The password confirmation does not match.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) {
      focusFirstInvalid();
      return;
    }

    setBusy(true);
    try {
      const head = await createDepartmentHead(college.id, {
        school_id: Number(values.school_id),
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        password_confirmation: values.password_confirmation,
      });
      onAssigned(head, `${head.first_name} ${head.last_name} is now the Department Head of ${collegeName}.`);
      onClose();
    } catch (cause) {
      const mapped = serverFieldErrors(cause);
      setErrors(mapped);
      if (Object.keys(mapped).some((key) => ASSIGN_FIELDS.includes(key))) focusFirstInvalid();
      else setFormError(getApiErrorMessage(cause, 'Could not assign the Department Head.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Assign Department Head"
      description={`${collegeName}. This account acts on every student organization in the college.`}
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={false}
      maxWidth="max-w-xl"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="assign-department-head-form" loading={busy}>Assign Department Head</Button>
        </>
      )}
    >
      <form id="assign-department-head-form" ref={formRef} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="School ID" required error={errors.school_id} className="sm:col-span-2">
          <Input inputMode="numeric" value={values.school_id} onChange={(event) => setField('school_id', event.target.value)} />
        </Field>
        <Field label="First name" required error={errors.first_name}>
          <Input autoComplete="off" value={values.first_name} onChange={(event) => setField('first_name', event.target.value)} />
        </Field>
        <Field label="Last name" required error={errors.last_name}>
          <Input autoComplete="off" value={values.last_name} onChange={(event) => setField('last_name', event.target.value)} />
        </Field>
        <Field label="Email" required error={errors.email} className="sm:col-span-2">
          <Input type="email" autoComplete="off" value={values.email} onChange={(event) => setField('email', event.target.value)} />
        </Field>
        <Field label="Password" required error={errors.password} hint="At least 8 characters. Share it privately; they can change it from their profile.">
          <Input type="password" autoComplete="new-password" value={values.password} onChange={(event) => setField('password', event.target.value)} />
        </Field>
        <Field label="Confirm password" required error={errors.password_confirmation}>
          <Input type="password" autoComplete="new-password" value={values.password_confirmation} onChange={(event) => setField('password_confirmation', event.target.value)} />
        </Field>
        {formError && <p role="alert" className="rounded-control border border-red-200 bg-red-50 p-3 text-sm font-semibold text-danger-strong sm:col-span-2">{formError}</p>}
      </form>
    </Modal>
  );
}

const CONFIRMS = {
  deactivate: {
    title: 'Deactivate Department Head',
    message: 'They will no longer be able to sign in, and any session they have open ends now. Their approvals and records stay in the history. You can reactivate them later.',
    confirmText: 'Deactivate',
    variant: 'danger',
  },
  reactivate: {
    title: 'Reactivate Department Head',
    message: 'They will be able to sign in again and act on every student organization in the college.',
    confirmText: 'Reactivate',
    variant: 'primary',
  },
  reset: {
    title: 'Send password reset',
    message: 'A secure reset link will be sent to their registered email address. Their current password is not shown.',
    confirmText: 'Send reset link',
    variant: 'primary',
  },
};

export function ManageDepartmentHeadModal({ college, head, onClose, onChanged }) {
  const initial = { first_name: head.first_name, last_name: head.last_name, email: head.email };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const formRef = useRef(null);
  const focusFirstInvalid = useFirstInvalidFocus(formRef);
  const collegeName = formatDisplayText(college.name);
  const isActive = head.account_status === 'active';
  const dirty = Object.keys(initial).some((key) => values[key].trim() !== initial[key]);

  function setField(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function save(event) {
    event.preventDefault();
    const found = validateIdentity(values, { requireSchoolId: false });
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) {
      focusFirstInvalid();
      return;
    }

    setBusy(true);
    try {
      const saved = await updateDepartmentHead(head.school_id, {
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email: values.email.trim().toLowerCase(),
      });
      onChanged(saved, 'Department Head details updated.');
      onClose();
    } catch (cause) {
      const mapped = serverFieldErrors(cause);
      setErrors(mapped);
      if (Object.keys(mapped).some((key) => key in initial)) focusFirstInvalid();
      else setFormError(getApiErrorMessage(cause, 'Could not update the Department Head.'));
      setBusy(false);
    }
  }

  async function confirmAction() {
    const action = confirming;
    setBusy(true);
    try {
      if (action === 'reset') {
        const response = await resetDepartmentHeadPassword(head.school_id);
        onChanged(null, response?.message || 'Password reset instructions were sent.');
      } else {
        const saved = await updateDepartmentHead(head.school_id, { account_status: action === 'deactivate' ? 'inactive' : 'active' });
        onChanged(saved, action === 'deactivate' ? `${head.name} was deactivated and can no longer sign in.` : `${head.name} was reactivated.`);
      }
      onClose();
    } catch (cause) {
      setConfirming(null);
      setFormError(getApiErrorMessage(cause, 'That action did not go through. Try again.'));
      setBusy(false);
    }
  }

  const confirmCopy = CONFIRMS[confirming] || CONFIRMS.reset;

  return (
    <>
      <Modal
        open={!confirming}
        title="Manage Department Head"
        description={collegeName}
        onClose={busy ? undefined : onClose}
        closeOnBackdrop={false}
        maxWidth="max-w-xl"
        footer={(
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" form="manage-department-head-form" loading={busy} disabled={!dirty}>Save changes</Button>
          </>
        )}
      >
        <form id="manage-department-head-form" ref={formRef} onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm font-medium text-ink-muted sm:col-span-2">School ID <strong className="font-bold text-ink">{head.school_id}</strong></p>
          <Field label="First name" required error={errors.first_name}>
            <Input autoComplete="off" value={values.first_name} onChange={(event) => setField('first_name', event.target.value)} />
          </Field>
          <Field label="Last name" required error={errors.last_name}>
            <Input autoComplete="off" value={values.last_name} onChange={(event) => setField('last_name', event.target.value)} />
          </Field>
          <Field label="Email" required error={errors.email} className="sm:col-span-2">
            <Input type="email" autoComplete="off" value={values.email} onChange={(event) => setField('email', event.target.value)} />
          </Field>
          {formError && <p role="alert" className="rounded-control border border-red-200 bg-red-50 p-3 text-sm font-semibold text-danger-strong sm:col-span-2">{formError}</p>}
        </form>
        <div className="mt-5 space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">Account status</span>
            <StatusBadge status={head.account_status} />
          </div>
          <p className="text-xs font-medium text-ink-muted">{isActive ? 'An active Department Head can sign in and review every organization in the college.' : 'This account cannot sign in. A college has one active Department Head at a time.'}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={KeyRound} disabled={!isActive || busy} onClick={() => setConfirming('reset')}>Send password reset</Button>
            {isActive
              ? <Button variant="danger" leftIcon={UserX} disabled={busy} onClick={() => setConfirming('deactivate')}>Deactivate</Button>
              : <Button variant="secondary" leftIcon={UserCheck} disabled={busy} onClick={() => setConfirming('reactivate')}>Reactivate</Button>}
          </div>
        </div>
      </Modal>
      <ConfirmModal
        open={Boolean(confirming)}
        title={confirmCopy.title}
        message={confirmCopy.message}
        recordName={head.name}
        confirmText={confirmCopy.confirmText}
        variant={confirmCopy.variant}
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmAction}
      />
    </>
  );
}
