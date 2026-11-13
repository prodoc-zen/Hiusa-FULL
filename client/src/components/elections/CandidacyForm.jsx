import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { getApiErrorMessage } from '../../utils/apiError';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';
const FILE_INPUT = 'block w-full text-sm text-ink file:mr-3 file:h-10 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle';

// mode "individual": the student's own candidacy (Save draft and Submit). mode "member": one member of a party
// list for the position given by positionId (asks for a school ID). mode "documents": only the three files, to
// answer a correction. `initial` is an application already on record; `disabled` holds every button while the
// official rules are not accepted. The handlers receive the payload the election service expects.
export default function CandidacyForm({ mode = 'individual', positions = [], positionId = null, initial = null, disabled = false, onSave, onSubmit }) {
  const [form, setForm] = useState({
    positionId: String(initial?.position?.id ?? initial?.position_id ?? ''),
    schoolId: '',
    platform: initial?.platform ?? '',
  });
  const [files, setFiles] = useState({ photoFile: null, cocFile: null, credentialsFile: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const documents = mode === 'documents';
  const member = mode === 'member';
  const onRecord = { photoFile: Boolean(initial?.photo_url), cocFile: Boolean(initial?.has_coc), credentialsFile: Boolean(initial?.has_credentials) };
  const hasDocument = (key) => Boolean(files[key]) || (!documents && onRecord[key]);
  const allDocuments = ['photoFile', 'cocFile', 'credentialsFile'].every(hasDocument);
  const anyFile = Object.values(files).some(Boolean);
  const chosenPosition = member ? positionId : (form.positionId ? Number(form.positionId) : null);
  const schoolId = form.schoolId.trim();

  const send = async (handler, payload) => {
    setError('');
    setBusy(true);
    try {
      await handler?.(payload);
    } catch (failure) {
      setError(getApiErrorMessage(failure, 'Could not save this candidacy.'));
    } finally {
      setBusy(false);
    }
  };

  const individualPayload = (submit) => ({
    position_id: chosenPosition,
    platform: form.platform,
    ...(initial ? {} : { rules_accepted: true }),
    submit,
    ...files,
  });

  const fileField = (key, label, accept) => (
    <Field label={label} hint={!documents && onRecord[key] ? 'A file is already on record. Choose one only to replace it.' : undefined}>
      <input
        type="file"
        accept={accept}
        className={FILE_INPUT}
        onChange={(event) => setFiles((current) => ({ ...current, [key]: event.target.files?.[0] ?? null }))}
      />
    </Field>
  );

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      {!documents && !member && (
        <Field label="Position" required>
          <Select value={form.positionId} onChange={(event) => setForm({ ...form, positionId: event.target.value })}>
            <option value="">Choose a position</option>
            {positions.map((position) => <option key={position.id} value={String(position.id)}>{position.title}</option>)}
          </Select>
        </Field>
      )}
      {member && (
        <Field label="School ID" required>
          <Input inputMode="numeric" value={form.schoolId} onChange={(event) => setForm({ ...form, schoolId: event.target.value })} />
        </Field>
      )}
      {fileField('photoFile', 'Formal photo', 'image/jpeg,image/png,image/webp')}
      {fileField('cocFile', 'Certificate of Candidacy', 'application/pdf,image/jpeg,image/png')}
      {fileField('credentialsFile', 'Credentials', 'application/pdf,image/jpeg,image/png')}
      {!documents && (
        <Field label="Campaign platform" optional>
          <Textarea rows={4} maxLength={2000} value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} />
        </Field>
      )}
      {error && <p role="alert" className={ALERT}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        {documents && (
          <Button disabled={disabled || !anyFile} loading={busy} onClick={() => send(onSubmit, { photoFile: files.photoFile, cocFile: files.cocFile, credentialsFile: files.credentialsFile })}>
            Replace documents
          </Button>
        )}
        {member && (
          <Button
            disabled={disabled || !/^\d+$/.test(schoolId)}
            loading={busy}
            onClick={() => send(onSubmit, { user_id: Number(schoolId), position_id: chosenPosition, platform: form.platform, ...files })}
          >
            Add member
          </Button>
        )}
        {mode === 'individual' && (
          <>
            <Button variant="secondary" disabled={disabled || !chosenPosition} loading={busy} onClick={() => send(onSave, individualPayload(false))}>Save draft</Button>
            <Button disabled={disabled || !chosenPosition || !allDocuments} loading={busy} onClick={() => send(onSubmit, individualPayload(true))}>Submit</Button>
          </>
        )}
      </div>
    </form>
  );
}
