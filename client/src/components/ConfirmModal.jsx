import { AlertCircle } from 'lucide-react';
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
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant={isDanger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmText}
          </Button>
        </>
      )}
    >
      <div className="flex items-center gap-3 rounded-card border border-line bg-subtle p-4">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-control ${isDanger ? 'bg-danger-tint text-danger-strong' : 'bg-brand-50 text-navy-800'}`}>
          <AlertCircle size={18} />
        </div>
        {recordName && <p className="text-sm font-extrabold text-ink">{recordName}</p>}
      </div>
    </Modal>
  );
}
