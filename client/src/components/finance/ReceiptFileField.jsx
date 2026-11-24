import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import Field from '../ui/Field';

export const RECEIPT_FILE_MESSAGE = 'Attach the official receipt as a JPG, PNG, WEBP or PDF up to 5 MB.';
export const RECEIPT_REQUIRED_MESSAGE = 'Attach the official receipt for this expense.';

const MAX_BYTES = 5120 * 1024;
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ACCEPT = [...MIME_TYPES, ...EXTENSIONS.map((extension) => `.${extension}`)].join(',');

const FILE_INPUT = 'block min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded-control file:border-0 file:bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

// The same rule the server enforces, so a wrong file is refused before it is uploaded. Returns the message, or null when the file is fine.
export function receiptFileProblem(file) {
  if (!file) return null;
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const typeOk = !file.type || MIME_TYPES.includes(file.type);
  if (!EXTENSIONS.includes(extension) || !typeOk || file.size > MAX_BYTES) return RECEIPT_FILE_MESSAGE;
  return null;
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// The official receipt of an expense. A file that fails the check is dropped and the reason shown, so the form never holds one the server would refuse.
export default function ReceiptFileField({ file, onChange, required = false, error = null, hint }) {
  const inputRef = useRef(null);
  const [problem, setProblem] = useState(null);

  function choose(event) {
    const chosen = event.target.files?.[0] ?? null;
    const message = receiptFileProblem(chosen);
    setProblem(message);
    if (message && inputRef.current) inputRef.current.value = '';
    onChange(message ? null : chosen);
  }

  function remove() {
    if (inputRef.current) inputRef.current.value = '';
    setProblem(null);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <Field label="Official receipt" optional={!required} hint={hint} error={problem || error}>
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={choose} className={FILE_INPUT} aria-required={required || undefined} />
      </Field>
      {file && (
        <p className="flex min-h-11 items-center gap-2 rounded-control bg-subtle px-3 text-sm text-ink">
          <Paperclip size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatFileSize(file.size)}</span>
          <button
            type="button"
            aria-label="Remove the chosen receipt file"
            onClick={remove}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </p>
      )}
    </div>
  );
}
