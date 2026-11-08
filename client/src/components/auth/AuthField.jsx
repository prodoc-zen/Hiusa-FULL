import { useId } from 'react';
import { Input } from '../ui';

export default function AuthField({
  id,
  label,
  trailing,
  error,
  hint,
  required,
  optional,
  className = '',
  inputClassName = '',
  ...inputProps
}) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId} className="text-[13px] font-medium text-ink">
        {label}
        {optional && !required && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
      </label>
      <div className="relative">
        <Input
          {...inputProps}
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          required={required}
          className={`${trailing ? 'pr-11' : ''} ${inputClassName}`}
        />
        {trailing}
      </div>
      {hint && !error && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}
