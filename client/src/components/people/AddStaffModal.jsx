import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, ErrorState, Field, Input, Skeleton } from '../ui';
import Modal from '../Modal';
import PersonPicker from './PersonPicker';
import notify from '../../lib/notify';
import { getStaffRecords, inviteCollegeStaff } from '../../services/collegeOrganizationService';
import { getApiErrorMessage } from '../../utils/apiError';

const searchRecords = async (params) => (await getStaffRecords(params)).data.data;
const describeRecord = (record) => record.position || '';

export default function AddStaffModal({ open, onClose }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [hasRecords, setHasRecords] = useState(false);
  const [plain, setPlain] = useState(false);
  const [record, setRecord] = useState(null);
  const [position, setPosition] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setRecord(null);
    setPosition('');
    setEmail('');
    setLink('');
    setError('');
    setCopied(false);
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
        setLoadError(getApiErrorMessage(cause, 'Could not load the school records.'));
        setLoading(false);
      });
    return () => { current = false; };
  }, [open, attempt]);

  async function createLink(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = plain ? { position_title: position.trim() } : { registry_school_id: record.school_id };
      if (email.trim()) body.email = email.trim();
      const response = await inviteCollegeStaff(body);
      setLink(response.data.magic_link);
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

  const emailField = (
    <Field label="Send it to (optional)" hint="Leave this empty to share the link yourself.">
      <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
    </Field>
  );

  function body() {
    if (loading) {
      return (
        <div role="status" aria-label="Loading school records" className="flex flex-col gap-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      );
    }
    if (loadError) {
      return <ErrorState title="Could not load the school records" description={loadError} onRetry={() => setAttempt((count) => count + 1)} className="px-0 py-4" />;
    }
    if (link) {
      return (
        <div className="flex flex-col gap-4">
          <Field label="Invite link">
            <Input readOnly value={link} onFocus={(event) => event.target.select()} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={copyLink} leftIcon={copied ? Check : Copy}>{copied ? 'Copied' : 'Copy link'}</Button>
          </div>
        </div>
      );
    }
    if (plain) {
      return (
        <form onSubmit={createLink} className="flex flex-col gap-4">
          {!hasRecords && (
            <p className="text-sm font-medium text-ink-muted">No office staff are in the school records for your college yet. You can create a plain link, or load employee records first.</p>
          )}
          <Field label="Position" required hint="For example, College Secretary.">
            <Input value={position} onChange={(event) => setPosition(event.target.value)} maxLength={100} autoComplete="off" />
          </Field>
          {emailField}
          {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {hasRecords ? (
              <Button variant="ghost" size="sm" onClick={() => { setPlain(false); setError(''); }}>Back to the school records</Button>
            ) : <span />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy} disabled={!position.trim()}>Create invite link</Button>
            </div>
          </div>
        </form>
      );
    }
    return (
      <form onSubmit={createLink} className="flex flex-col gap-4">
        <PersonPicker
          label="Find in the school records"
          placeholder="Type a name"
          search={searchRecords}
          describe={describeRecord}
          value={record}
          onSelect={setRecord}
        />
        {record && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID number" hint="Given by the school. It cannot be changed.">
              <Input readOnly value={String(record.school_id)} />
            </Field>
            <Field label="Position">
              <Input readOnly value={record.position || 'Office staff'} />
            </Field>
          </div>
        )}
        {record && emailField}
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setPlain(true); setError(''); }}>Not in the school records? Create a plain invite link</Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!record}>Create invite link</Button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <Modal
      open={open}
      title="Add office staff"
      description="They get a link that works once and expires in 48 hours, and they only choose their email and password."
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      {body()}
    </Modal>
  );
}
