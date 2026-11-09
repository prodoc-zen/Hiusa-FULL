import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, ErrorState, Field, Input, Skeleton } from '../ui';
import PersonPicker from './PersonPicker';
import notify from '../../lib/notify';
import { getStaffRecords, inviteCollegeStaff } from '../../services/collegeOrganizationService';
import { getApiErrorMessage } from '../../utils/apiError';

const searchRecords = async (params) => (await getStaffRecords(params)).data.data;
const describeRecord = (record) => [record.position, record.has_account ? 'Has an account' : ''].filter(Boolean).join(' · ');
const EMPTY_PLAIN = { first_name: '', last_name: '', email: '', position: '' };

// Office staff are employees, never students: the person comes from the employee records of the college, or, when
// they are not in the records, from a name and email the dean types. Either way the result is a link the dean copies.
export default function StaffInvitePanel({ onCreated, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [hasRecords, setHasRecords] = useState(false);
  const [plain, setPlain] = useState(false);
  const [record, setRecord] = useState(null);
  const [position, setPosition] = useState('');
  const [details, setDetails] = useState(EMPTY_PLAIN);
  const [link, setLink] = useState('');
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
        setPlain(!response.data.has_records);
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

  function setDetail(key, value) {
    setDetails((existing) => ({ ...existing, [key]: value }));
  }

  async function createLink(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = plain
        ? { first_name: details.first_name.trim(), last_name: details.last_name.trim(), email: details.email.trim(), position_title: details.position.trim() }
        : { registry_school_id: record.school_id, ...(position.trim() && { position_title: position.trim() }) };
      const response = await inviteCollegeStaff(body);
      setLink(response.data.magic_link);
      onCreated?.();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not create the link. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
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
  if (link) {
    return (
      <div className="flex flex-col gap-4">
        <Field label="Invite link" hint="It works once and expires in 48 hours. Nothing is sent: copy it and share it yourself.">
          <Input readOnly value={link} onFocus={(event) => event.target.select()} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Done</Button>
          <Button onClick={copyLink} leftIcon={copied ? Check : Copy}>{copied ? 'Copied' : 'Copy link'}</Button>
        </div>
      </div>
    );
  }

  const cancel = <Button variant="secondary" onClick={onCancel}>Cancel</Button>;

  if (plain) {
    const complete = details.first_name.trim() && details.last_name.trim() && details.email.trim() && details.position.trim();
    return (
      <form onSubmit={createLink} className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          {hasRecords
            ? 'For someone who is not in the employee records. Students cannot be office staff.'
            : 'No employee records are loaded for your college yet. You can invite a faculty member or other staff by name and email. Students cannot be office staff.'}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required>
            <Input value={details.first_name} onChange={(event) => setDetail('first_name', event.target.value)} maxLength={60} autoComplete="off" />
          </Field>
          <Field label="Last name" required>
            <Input value={details.last_name} onChange={(event) => setDetail('last_name', event.target.value)} maxLength={60} autoComplete="off" />
          </Field>
        </div>
        <Field label="Email" required hint="The link only works for this email.">
          <Input type="email" value={details.email} onChange={(event) => setDetail('email', event.target.value)} maxLength={100} autoComplete="off" />
        </Field>
        <Field label="Position" required hint="For example, College Secretary.">
          <Input value={details.position} onChange={(event) => setDetail('position', event.target.value)} maxLength={100} autoComplete="off" />
        </Field>
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {hasRecords ? (
            <Button variant="ghost" size="sm" onClick={() => { setPlain(false); setError(''); }}>Back to the employee records</Button>
          ) : <span />}
          <div className="flex flex-wrap justify-end gap-2">
            {cancel}
            <Button type="submit" loading={busy} disabled={!complete}>Create invite link</Button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={createLink} className="flex flex-col gap-4">
      <PersonPicker
        label="Find in the employee records"
        placeholder="Type a name"
        search={searchRecords}
        describe={describeRecord}
        value={record}
        onSelect={pick}
      />
      {record && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID number" hint="Given by the school. It cannot be changed.">
            <Input readOnly value={String(record.school_id)} />
          </Field>
          <Field label="Position">
            <Input value={position} onChange={(event) => setPosition(event.target.value)} maxLength={100} placeholder="Office staff" autoComplete="off" />
          </Field>
        </div>
      )}
      {record?.has_account && (
        <p className="text-sm text-ink-muted">They already have an account. They sign in and accept the link to join your office.</p>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setPlain(true); setError(''); }}>Not in the records? Invite by name and email</Button>
        <div className="flex flex-wrap justify-end gap-2">
          {cancel}
          <Button type="submit" loading={busy} disabled={!record}>Create invite link</Button>
        </div>
      </div>
    </form>
  );
}
