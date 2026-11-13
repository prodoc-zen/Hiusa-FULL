import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import { scheduleRunoff } from '../../services/electionService';
import { getApiErrorMessage } from '../../utils/apiError';
import { isoToLocalDateTimeInput, localDateTimeToIso } from '../../utils/dateTime';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

const at = (value) => (value ? new Date(value).getTime() : null);

// The Admin sets the one runoff: when voting starts and ends and when its results are published. `initial` is a
// schedule already on record (ISO instants), shown for editing until the runoff starts. The server checks the rest.
export default function RunoffScheduleForm({ electionId, initial = null, onScheduled }) {
  const [form, setForm] = useState({
    starts: isoToLocalDateTimeInput(initial?.starts_at),
    ends: isoToLocalDateTimeInput(initial?.ends_at),
    publish: isoToLocalDateTimeInput(initial?.publish_at),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const endsError = form.starts && form.ends && at(form.ends) <= at(form.starts) ? 'Runoff voting must end after it starts.' : '';
  const publishError = form.ends && form.publish && at(form.publish) < at(form.ends) ? 'Results cannot be published before voting ends.' : '';
  const complete = Boolean(form.starts && form.ends && form.publish) && !endsError && !publishError;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!complete) return;
    setError('');
    setBusy(true);
    try {
      await scheduleRunoff(electionId, {
        runoff_starts_at: localDateTimeToIso(form.starts),
        runoff_ends_at: localDateTimeToIso(form.ends),
        runoff_publish_at: localDateTimeToIso(form.publish),
      });
      onScheduled?.();
    } catch (failure) {
      setError(getApiErrorMessage(failure, 'Could not schedule the runoff.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Runoff voting starts" required>
          <Input type="datetime-local" value={form.starts} onChange={update('starts')} />
        </Field>
        <Field label="Runoff voting ends" required error={endsError}>
          <Input type="datetime-local" value={form.ends} onChange={update('ends')} />
        </Field>
        <Field label="Results published" required error={publishError}>
          <Input type="datetime-local" value={form.publish} onChange={update('publish')} />
        </Field>
      </div>
      {error && <p role="alert" className={ALERT}>{error}</p>}
      <Button type="submit" disabled={!complete} loading={busy}>{initial?.starts_at ? 'Update schedule' : 'Schedule runoff'}</Button>
    </form>
  );
}
