import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
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
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="h-11 rounded-full border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-[#F8FBFD] disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || (confirmationText && entered.trim() !== confirmationText)}
            className={`h-11 rounded-full px-4 text-sm font-bold text-white transition disabled:opacity-50 ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0878B7] hover:bg-[#0F2F62]'
            }`}
          >
            {busy ? 'Working...' : confirmText}
          </button>
        </>
      )}
    >
      <div className="rounded-2xl border border-[#DDE7EF] bg-[#F8FBFD] p-5 text-center">
        <div className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${isDanger ? 'bg-red-50 text-red-600' : 'bg-[#E6F6FD] text-[#0F2F62]'}`}><AlertCircle size={22} /></div>
        <div className="mt-3">
          {recordName && <p className="text-sm font-extrabold text-[#0F172A]">{recordName}</p>}
          <p className="mt-1 text-sm font-medium leading-5 text-slate-600">
            {isDanger ? 'This action may be irreversible. Please confirm before continuing.' : 'Please confirm this action before continuing.'}
          </p>
        </div>
      </div>
      {confirmationText && <label className="mt-4 block text-xs font-semibold text-slate-700">Type <strong>{confirmationText}</strong> to confirm<input value={entered} onChange={(event) => setConfirmation({ recordName, value: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-[#DDE7EF] px-3 text-sm" /></label>}
    </Modal>
  );
}
