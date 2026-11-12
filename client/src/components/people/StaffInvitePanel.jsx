import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, ErrorState, Field, Input, Skeleton } from '../ui';
import PersonPicker from './PersonPicker';
import notify from '../../lib/notify';
import { getStaffRecords, inviteCollegeStaff } from '../../services/collegeOrganizationService';
import { getApiErrorMessage } from '../../utils/apiError';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const searchRecords = async (params) => (await getStaffRecords(params)).data.data;
const describeRecord = (record) => [record.position, record.has_account ? 'Has an account' : ''].filter(Boolean).join(' · ');

// Office staff are employees, never students. The dean either picks a person from the employee records of the
// college or makes a link with nothing filled in; the invited person types their own name and School ID.
// An email is optional: with it the link only works for that address and is emailed when mail is set up.
export default function StaffInvitePanel({ onCreated, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [hasRecords, setHasRecords] = useState(false);
  const [record, setRecord] = useState(null);
  const [position, setPosition] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoadError('');
    setLoading(true);
    getStaffRecords({})
      .then((response) => {
        if (!current) return;
        setHasRecords(Boolean(response.data.has_records));
        setLoading(false);
      })
      .catch((cause) => {
        if (!current) return;
        setLoadError(getApiErrorMessage(cause, 'Could not load the employee records.'));
        setLoading(false);
      });
    return () => { current = false; };
  }, [attempt]);

  function pick(next) {
    setRecord(next);
    setPosition(next?.position || '');
  }

  async function createLink(event) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!record && address && !EMAIL_PATTERN.test(address)) {
      setEmailError('That email does not look right. Fix it or leave it empty.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = record
        ? { registry_school_id: record.school_id, ...(position.trim() && { position_title: position.trim() }) }
        : { ...(address && { email: address }), ...(position.trim() && { position_title: position.trim() }) };
      const response = await inviteCollegeStaff(body);
      setResult({ ...response.data, sentTo: record ? '' : address });
      onCreated?.();
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

  if (loading) {
    return (
      <div role="status" aria-label="Loading employee records" className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (loadError) {
    return <ErrorState title="Could not load the employee records" description={loadError} onRetry={() => setAttempt((count) => count + 1)} className="px-0 py-4" />;
  }
  if (result) {
    const { sentTo } = result;
    return (
      <div className="flex flex-col gap-4">
        <Field label="Invite link" hint="It works once and expires in 48 hours. Copy it and share it yourself.">
          <Input readOnly value={result.magic_link} onFocus={(event) => event.target.select()} />
        </Field>
        {result.emailed && <p role="status" className="text-sm font-medium text-ink-muted">We also emailed it to {sentTo}.</p>}
        {!result.emailed && sentTo && result.mail_is_off && <p role="status" className="text-sm font-medium text-ink-muted">Email is switched off, so nothing was sent to {sentTo}. Copy the link and send it yourself.</p>}
        {!result.emailed && sentTo && !result.mail_is_off && <p role="alert" className="text-sm font-semibold text-danger-strong">The email could not be sent. Copy the link and send it yourself.</p>}
        {!sentTo && <p role="status" className="text-sm font-medium text-ink-muted">Nothing was emailed.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Done</Button>
          <Button onClick={copyLink} leftIcon={copied ? Check : Copy}>{copied ? 'Copied' : 'Copy link'}</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={createLink} className="flex flex-col gap-4" noValidate>
      {hasRecords && (
        <PersonPicker
          label="Find in the employee records"
          placeholder="Type a name"
          search={searchRecords}
          describe={describeRecord}
          value={record}
          onSelect={pick}
        />
      )}
      {record ? (
        <Field label="School ID" hint="Given by the school. It cannot be changed.">
          <Input readOnly value={String(record.school_id)} />
        </Field>
      ) : (
        <Field
          label="Email"
          optional
          error={emailError}
          hint="Leave it empty and the link works for whoever opens it first. Add it and the link only works for that email, and is emailed when email is set up."
        >
          <Input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} maxLength={100} autoComplete="off" />
        </Field>
      )}
      <Field label="Position" optional>
        <Input value={position} onChange={(event) => setPosition(event.target.value)} maxLength={100} placeholder="Office staff" autoComplete="off" />
      </Field>
      {record?.has_account && (
        <p className="text-sm text-ink-muted">They already have an account. They sign in and accept the link to join your office.</p>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>Create invite link</Button>
      </div>
    </form>
  );
}
