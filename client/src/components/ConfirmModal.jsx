import { AlertCircle } from 'lucide-react';
import Modal from './Modal';

export default function ConfirmModal({
  open,
  title,
  message,
  recordName,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  busy = false,
  onCancel,
  onConfirm,
}) {
  const isDanger = variant === 'danger';

  return (
    <Modal
      open={open}
      title={title}
      description={message}
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={(
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-control border border-line bg-surface px-4 text-sm font-bold text-ink-muted transition-[transform,background-color,color] duration-[120ms] ease-out active:scale-[0.97] hover:bg-subtle disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`h-10 rounded-control px-4 text-sm font-bold text-white transition-[transform,background-color] duration-[120ms] ease-out active:scale-[0.97] disabled:opacity-50 ${
              isDanger ? 'bg-danger hover:bg-danger-strong' : 'bg-brand-700 hover:bg-navy-800'
            }`}
          >
            {busy ? 'Working...' : confirmText}
          </button>
        </>
      )}
    >
      <div className="flex gap-3 rounded-card border border-line bg-subtle p-4">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-control ${isDanger ? 'bg-danger-tint text-danger-strong' : 'bg-brand-50 text-navy-800'}`}>
          <AlertCircle size={18} />
        </div>
        <div>
          {recordName && <p className="text-sm font-extrabold text-ink">{recordName}</p>}
          <p className="mt-1 text-sm font-medium leading-5 text-ink-muted">
            {isDanger ? 'This action may be irreversible. Please confirm before continuing.' : 'Please confirm this action before continuing.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
