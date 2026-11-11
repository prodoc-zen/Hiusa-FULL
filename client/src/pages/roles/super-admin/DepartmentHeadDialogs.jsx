import { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, UserCheck, UserX } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import OneTimeLinkModal from '../../../components/users/OneTimeLinkModal';
import { Button, Field, Input, Select, StatusBadge } from '../../../components/ui';
import { inviteDepartmentHead, resetDepartmentHeadPassword, updateDepartmentHead } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDisplayText } from '../../../utils/displayText.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function validateIdentity(values) {
  const found = {};
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

export function InviteDepartmentHeadModal({ colleges, initialCollegeId = '', onClose, onCreated }) {
  const [collegeId, setCollegeId] = useState(initialCollegeId ? String(initialCollegeId) : '');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef(null);
  const focusFirstInvalid = useFirstInvalidFocus(formRef);
  const chosen = colleges.find((college) => String(college.id) === collegeId);

  async function submit(event) {
    event.preventDefault();
    const found = {};
    if (!collegeId) found.college = 'Choose a college.';
    const address = email.trim();
    if (address && !EMAIL_PATTERN.test(address)) found.email = 'Enter a valid email address, or leave it blank.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) {
      focusFirstInvalid();
      return;
    }

    setBusy(true);
    try {
      const response = await inviteDepartmentHead(collegeId, address ? { email: address.toLowerCase() } : {});
      setResult(response);
    } catch (cause) {
      const mapped = serverFieldErrors(cause);
      if (mapped.email) {
        setErrors({ email: mapped.email });
        focusFirstInvalid();
      } else {
        setFormError(getApiErrorMessage(cause, 'Could not create the link. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.magic_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function finish() {
    onCreated(result ? `Link created for ${formatDisplayText(chosen?.name || 'the college')}. It works once and expires in 48 hours.` : '');
    onClose();
  }

  if (result) {
    return (
      <Modal
        open
        title="Link ready"
        description={`Send this to the person who will lead ${formatDisplayText(chosen?.name || 'the college')}. They fill in their own details.`}
        onClose={finish}
        maxWidth="max-w-xl"
        footer={<Button onClick={finish}>Done</Button>}
      >
        <div className="space-y-3">
          <Field label="Invitation link" hint="Works once and expires in 48 hours.">
            <Input readOnly value={result.magic_link} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
          </Field>
          <Button variant="secondary" leftIcon={copied ? Check : Copy} onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
          {result.emailed && <p role="status" className="text-sm font-medium text-ink-muted">We also emailed it to {email.trim().toLowerCase()}.</p>}
          {email.trim() && !result.emailed && <p role="alert" className="text-sm font-semibold text-danger-strong">The email could not be sent. Copy the link and send it yourself.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Invite Department Head"
      description="Make a link for the dean. They fill in their own name, email and password."
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={false}
      maxWidth="max-w-xl"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="invite-department-head-form" loading={busy}>Create link</Button>
        </>
      )}
    >
      <form id="invite-department-head-form" ref={formRef} onSubmit={submit} noValidate className="space-y-4">
        <Field label="College" required error={errors.college}>
          <Select value={collegeId} onChange={(event) => { setCollegeId(event.target.value); setErrors((current) => ({ ...current, college: undefined })); }}>
            <option value="">Choose a college</option>
            {colleges.map((college) => <option key={college.id} value={college.id}>{formatDisplayText(college.name)}</option>)}
          </Select>
        </Field>
        <Field label="Send it to" optional error={errors.email} hint="We email the link to this address. You can also copy it after.">
          <Input type="email" autoComplete="off" value={email} onChange={(event) => { setEmail(event.target.value); setErrors((current) => ({ ...current, email: undefined })); }} />
        </Field>
        {formError && <p role="alert" className="rounded-control border border-red-200 bg-red-50 p-3 text-sm font-semibold text-danger-strong">{formError}</p>}
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
    message: 'This creates a one-time reset link. It is shown to you once to hand over, and it is emailed only when email is turned on. Their current password is not shown.',
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
  const [resetLink, setResetLink] = useState('');
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
    const found = validateIdentity(values);
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
        if (response?.reset_link) {
          setResetLink(response.reset_link);
          setConfirming(null);
          setBusy(false);
          return;
        }
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
        open={!confirming && !resetLink}
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
          {!isActive && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-ink">Account status</span>
              <StatusBadge status={head.account_status} />
            </div>
          )}
          <p className="text-xs text-ink-muted">{isActive ? 'This account can sign in and review every organization in the college.' : 'This account cannot sign in. A college has one active Department Head at a time.'}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={KeyRound} disabled={!isActive || busy} onClick={() => setConfirming('reset')}>Send password reset</Button>
            {isActive
              ? <Button variant="danger" leftIcon={UserX} disabled={busy} onClick={() => setConfirming('deactivate')}>Deactivate</Button>
              : <Button variant="secondary" leftIcon={UserCheck} disabled={busy} onClick={() => setConfirming('reactivate')}>Reactivate</Button>}
          </div>
        </div>
      </Modal>
      {resetLink && (
        <OneTimeLinkModal
          title="Reset link ready"
          description={`Send this to ${head.name}. It lets them choose a new password.`}
          label="Reset link"
          hint="Works once and expires in 60 minutes. It is not shown again."
          link={resetLink}
          onClose={() => { onChanged(null, `Reset link created for ${head.name}.`); onClose(); }}
        />
      )}
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
