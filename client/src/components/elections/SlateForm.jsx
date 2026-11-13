import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import CandidacyForm from './CandidacyForm';
import { getApiErrorMessage } from '../../utils/apiError';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';
const FILE_INPUT = 'block w-full text-sm text-ink file:mr-3 file:h-10 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle';
const DEFAULT_COLOR = '#0B8ED0';

const memberName = (member) => member.user?.name ?? member.user_name ?? '';
const memberPositionId = (member) => member.position?.id ?? member.position_id;

// The party list a representative files: first its name, motto and color, then one member per position.
// Seats may stay vacant. `disabled` holds every action while the official rules are not accepted.
export default function SlateForm({ positions = [], slate = null, disabled = false, onCreate, onAddMember, onSubmitSlate }) {
  const [form, setForm] = useState({ name: '', motto: '', color: DEFAULT_COLOR });
  const [bannerFile, setBannerFile] = useState(null);
  const [addingFor, setAddingFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action) => {
    setError('');
    setBusy(true);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(getApiErrorMessage(failure, 'Could not save this party list.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addingPosition = positions.find((position) => position.id === addingFor);
  const members = slate?.members ?? [];

  if (!slate) {
    return (
      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <Field label="Party list name" required>
          <Input value={form.name} maxLength={255} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Motto" required>
          <Input value={form.motto} maxLength={255} onChange={(event) => setForm({ ...form, motto: event.target.value })} />
        </Field>
        <Field label="Color">
          <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value.toUpperCase() })} className="h-10 w-20 cursor-pointer rounded-control border border-line bg-surface p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" />
        </Field>
        <Field label="Banner" optional hint="JPEG, PNG or WebP, up to 5 MB.">
          <input type="file" accept="image/jpeg,image/png,image/webp" className={FILE_INPUT} onChange={(event) => setBannerFile(event.target.files?.[0] ?? null)} />
        </Field>
        {error && <p role="alert" className={ALERT}>{error}</p>}
        <Button
          disabled={disabled || !form.name.trim() || !form.motto.trim()}
          loading={busy}
          onClick={() => run(() => onCreate?.({ name: form.name.trim(), motto: form.motto.trim(), color: form.color, rules_accepted: true, bannerFile }))}
        >
          Create party list
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-ink">
        <span aria-hidden="true" className="size-3 rounded-full border border-line" style={{ backgroundColor: slate.color }} />
        <span className="font-semibold">{slate.name}</span>
        <span className="text-ink-muted-strong">{slate.motto}</span>
      </p>
      <ul className="divide-y divide-line rounded-control border border-line">
        {positions.map((position) => {
          const seated = members.filter((member) => memberPositionId(member) === position.id);
          const seats = position.max_winners ?? 1;
          return (
            <li key={position.id} aria-label={position.title} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <p className="font-semibold text-ink">{position.title}</p>
                {seated.length > 0
                  ? seated.map((member) => <p key={member.id} className="text-ink-muted-strong">{memberName(member)}</p>)
                  : <p className="text-ink-muted">Vacant</p>}
              </div>
              {seated.length < seats && (
                <Button variant="secondary" size="sm" disabled={disabled} onClick={() => { setError(''); setAddingFor(position.id); }}>Add member</Button>
              )}
            </li>
          );
        })}
      </ul>
      {addingPosition && (
        <div className="space-y-3 rounded-control border border-line p-4">
          <p className="text-sm font-semibold text-ink">New member for {addingPosition.title}</p>
          <CandidacyForm
            key={addingPosition.id}
            mode="member"
            positions={positions}
            positionId={addingPosition.id}
            disabled={disabled}
            onSubmit={async (payload) => {
              await onAddMember?.(payload);
              setAddingFor(null);
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => setAddingFor(null)}>Cancel</Button>
        </div>
      )}
      {error && <p role="alert" className={ALERT}>{error}</p>}
      <Button disabled={disabled || members.length === 0} loading={busy} onClick={() => run(() => onSubmitSlate?.())}>Submit party list</Button>
    </div>
  );
}
