import { Loader2 } from 'lucide-react';

export default function ActiveSwitch({ checked, onChange, label, busy = false, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-xs font-semibold text-ink outline-none transition-colors duration-150 focus-visible:ring-4 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ${checked ? 'bg-success' : 'bg-ink-soft'}`}>
        <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-surface transition-transform duration-150 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
      {checked ? 'Active' : 'Inactive'}
    </button>
  );
}
