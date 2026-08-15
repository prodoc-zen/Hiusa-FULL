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
            className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-[#F8FBFD] disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`h-10 rounded-lg px-4 text-sm font-bold text-white transition disabled:opacity-50 ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0B8ED0] hover:bg-[#0878B7]'
            }`}
          >
            {busy ? 'Working...' : confirmText}
          </button>
        </>
      )}
    >
      <div className="flex gap-3 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${isDanger ? 'bg-red-50 text-red-600' : 'bg-[#E9F7FD] text-[#0B8ED0]'}`}>
          <AlertCircle size={18} />
        </div>
        <div>
          {recordName && <p className="text-sm font-extrabold text-[#0F172A]">{recordName}</p>}
          <p className="mt-1 text-sm font-medium leading-5 text-slate-600">
            {isDanger ? 'This action may be irreversible. Please confirm before continuing.' : 'Please confirm this action before continuing.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
