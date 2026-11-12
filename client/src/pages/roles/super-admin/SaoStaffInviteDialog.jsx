import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Modal from '../../../components/Modal';
import PendingStaffInvites from '../../../components/people/PendingStaffInvites';
import { Button, Field, Input } from '../../../components/ui';
import notify from '../../../lib/notify';
import { createSaoStaffInvitation, getSaoStaffInvitations, relinkSaoStaffInvitation, revokeSaoStaffInvitation } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PENDING_API = { list: getSaoStaffInvitations, relink: relinkSaoStaffInvitation, revoke: revokeSaoStaffInvitation };

// The SAO adds the people who help run the SAO with a link that works once and expires in 48 hours.
// The person types their own name, School ID, email and password; an email here only ties the link to that address.
export default function SaoStaffInviteDialog({ onClose }) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function createLink(event) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (address && !EMAIL_PATTERN.test(address)) {
      setEmailError('Enter a valid email address, or leave it blank.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await createSaoStaffInvitation(address ? { email: address } : {});
      setResult({ ...response, sentTo: address });
      setReloadKey((count) => count + 1);
    } catch (cause) {
      const message = cause.response?.data?.errors?.email?.[0];
      if (message) setEmailError(message);
      else setError(getApiErrorMessage(cause, 'Could not create the link. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.magic_link);
      setCopied(true);
    } catch {
      notify.error('Could not copy the link. Select it and copy it by hand.');
    }
  }

  const sentTo = result?.sentTo;

  return (
    <Modal
      open
      title="Add SAO staff"
      description="Someone who will help run the SAO. They get a link that works once and expires in 48 hours, and fill in their own name, School ID, email and password."
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={false}
      maxWidth="max-w-lg"
      footer={result ? (
        <Button onClick={onClose}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="add-sao-staff-form" loading={busy}>Create link</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-6">
        {result ? (
          <div className="flex flex-col gap-3">
            <Field label="Invite link" hint="It works once and expires in 48 hours. Copy it and share it yourself.">
              <Input readOnly value={result.magic_link} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
            </Field>
            <div>
              <Button variant="secondary" leftIcon={copied ? Check : Copy} onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
            </div>
            {result.emailed && <p role="status" className="text-sm font-medium text-ink-muted">We also emailed it to {sentTo}.</p>}
            {!result.emailed && sentTo && result.mail_is_off && <p role="status" className="text-sm font-medium text-ink-muted">Email is switched off, so nothing was sent to {sentTo}. Copy the link and send it yourself.</p>}
            {!result.emailed && sentTo && !result.mail_is_off && <p role="alert" className="text-sm font-semibold text-danger-strong">The email could not be sent. Copy the link and send it yourself.</p>}
            {!sentTo && <p role="status" className="text-sm font-medium text-ink-muted">Nothing was emailed.</p>}
          </div>
        ) : (
          <form id="add-sao-staff-form" onSubmit={createLink} noValidate className="flex flex-col gap-4">
            <Field
              label="Email"
              optional
              error={emailError}
              hint="Leave it empty and the link works for whoever opens it first. Add it and the link only works for that email, and is emailed when email is set up."
            >
              <Input type="email" autoComplete="off" maxLength={100} value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} />
            </Field>
            {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
          </form>
        )}
        <PendingStaffInvites api={PENDING_API} reloadKey={reloadKey} />
      </div>
    </Modal>
  );
}
