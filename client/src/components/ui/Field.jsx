import { cloneElement, isValidElement, useId } from 'react';
import FieldIcon from '../FieldIcon.jsx';

export default function Field({ label, hint, error, required, children, className = '' }) {
  const generatedId = useId();
  const childProps = isValidElement(children) ? children.props : {};
  const controlId = childProps.id || generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    childProps['aria-describedby'],
    hint && !error ? hintId : null,
    error ? errorId : null,
  ].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
      id: controlId,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : childProps['aria-invalid'],
      'aria-required': required || childProps['aria-required'] || undefined,
      required: required || childProps.required,
    })
    : children;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId} className="text-[13px] font-semibold text-ink">
        <FieldIcon label={label} />
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs font-medium text-ink-muted">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>
      )}
    </div>
  );
}
