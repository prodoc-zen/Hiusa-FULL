import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import Button from './ui/Button';
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
      description={message}
      onClose={busy ? undefined : cancel}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy} className="rounded-full">
            {cancelText}
          </Button>
          <Button variant={isDanger ? 'danger' : 'primary'} onClick={confirm} loading={busy} disabled={Boolean(confirmationText && entered.trim() !== confirmationText)} className="rounded-full">
            {confirmText}
          </Button>
        </>
      )}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-subtle p-4">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isDanger ? 'bg-danger-tint text-danger-strong' : 'bg-brand-50 text-navy-800'}`}>
          <AlertCircle size={18} />
        </div>
        {recordName && <p className="text-sm font-extrabold text-ink">{recordName}</p>}
      </div>
      {confirmationText && <label className="mt-4 block text-xs font-semibold text-slate-700">Type <strong>{confirmationText}</strong> to confirm<input value={entered} onChange={(event) => setConfirmation({ recordName, value: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-[#DDE7EF] px-3 text-sm" /></label>}
    </Modal>
  );
}
