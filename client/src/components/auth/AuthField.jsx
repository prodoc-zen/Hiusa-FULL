import { useId } from 'react';
import { Input } from '../ui';
import FieldIcon from '../FieldIcon.jsx';

export default function AuthField({
  id,
  label,
  icon: Icon,
  trailing,
  error,
  hint,
  required,
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
      <label htmlFor={controlId} className="text-[13px] font-semibold text-ink">
        <FieldIcon label={label} />
        {label}
      </label>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" size={17} aria-hidden="true" />}
        <Input
          {...inputProps}
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          required={required}
          className={`${Icon ? 'pl-10' : ''} ${trailing ? 'pr-11' : ''} ${inputClassName}`}
        />
        {trailing}
      </div>
      {hint && !error && <p id={hintId} className="text-xs font-medium text-ink-muted">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}
