import { useEffect, useRef } from 'react';

// The "select all" box of a list. With some rows ticked and not all it shows the in-between state, and
// a click from there ticks the rest. total is how many rows select all covers, selected how many of them are ticked.
export default function SelectAllCheckbox({ label, selected, total, onChange, disabled = false, className = '' }) {
  const ref = useRef(null);
  const some = selected > 0 && selected < total;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <label className={`inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={total > 0 && selected === total}
        disabled={disabled || total === 0}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-brand-700"
      />
      {label}
    </label>
  );
}
