import { useState } from 'react';
import Modal from '../Modal';
import { Button, Field, Input } from '../ui';

export default function PermanentDeleteModal({ name, kind, busy, error, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('');
  return <Modal open title={`Permanently delete ${kind}`} onClose={busy ? undefined : onClose} closeOnBackdrop={false}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="danger" disabled={confirmation !== name} loading={busy} onClick={() => onConfirm(confirmation)}>Permanently delete {kind}</Button></>}>
    <p className="text-sm leading-6 text-ink">This permanently removes {name}, its {kind === 'college' ? 'organizations, ' : ''}membership profiles, operational records, and uploaded files. Accounts with no other profiles are deleted. Profiles in other organizations are kept. This cannot be undone.</p>
    <Field label={`Type the ${kind} name to confirm`} hint={name} className="mt-4"><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></Field>
    {error && <p role="alert" className="mt-3 text-sm text-danger-strong">{error}</p>}
  </Modal>;
}
