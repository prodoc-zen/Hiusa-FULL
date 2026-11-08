import { useState } from 'react';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './Modal';

export default function ConfirmModal({
  open,
  title,
  message,
  recordName,
  confirmText,
  cancelText = 'Cancel',
  variant = 'danger',
  busy = false,
  onCancel,
  onConfirm,
  confirmationText,
  error,
}) {
  const isDanger = variant === 'danger';
  const [confirmation, setConfirmation] = useState({ recordName: '', value: '' });
  const entered = confirmation.recordName === recordName ? confirmation.value : '';
  const cancel = () => { setConfirmation({ recordName: '', value: '' }); onCancel?.(); };
  const confirm = () => { setConfirmation({ recordName: '', value: '' }); onConfirm?.(); };

  return (
    <Modal
      open={open}
      title={title}
      description={recordName ? message : undefined}
      onClose={busy ? undefined : cancel}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant={isDanger ? 'danger' : 'primary'} onClick={confirm} loading={busy} disabled={Boolean(confirmationText && entered.trim() !== confirmationText)}>
            {confirmText}
          </Button>
        </>
      )}
    >
      <p className="text-sm font-semibold text-ink">{recordName || message}</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error}</p>}
      {confirmationText && (
        <label className="mt-4 flex flex-col gap-1.5 text-[13px] font-medium text-ink">
          <span>Type <strong className="font-semibold">{confirmationText}</strong> to confirm</span>
          <Input value={entered} onChange={(event) => setConfirmation({ recordName, value: event.target.value })} />
        </label>
      )}
    </Modal>
  );
}
