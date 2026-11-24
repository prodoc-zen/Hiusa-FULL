import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Textarea from '../ui/Textarea';
import Modal from '../Modal';
import { peso } from '../../lib/format';

export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;

export function reasonIsGiven(reason) {
  return String(reason ?? '').trim().length >= MIN_REASON_LENGTH;
}

// An entry is never deleted. It leaves the ledger and every total, the receipt file stays, and the reason is on record.
export default function ArchiveTransactionModal({ transaction, busy = false, error = null, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const given = reasonIsGiven(reason);

  return (
    <Modal
      open
      title="Archive this transaction?"
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      titleClassName="text-danger-strong"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(reason.trim())} loading={busy} disabled={!given}>Archive transaction</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink">
          <span className="font-semibold">{transaction.description || `Transaction ${transaction.id}`}</span>
          {' '}({transaction.type === 'income' ? '+' : '-'}{peso(transaction.amount)}) leaves the ledger and every total, and its budget balance is adjusted.
          The receipt file is kept. It stays listed under Show archived, with your reason.
        </p>
        <Field label="Reason for archiving" hint={`At least ${MIN_REASON_LENGTH} characters.`}>
          <Textarea
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Recorded twice by mistake"
          />
        </Field>
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Modal>
  );
}
