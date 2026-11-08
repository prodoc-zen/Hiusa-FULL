import { cloneElement, isValidElement, useId } from 'react';

// `optional` appends the "(optional)" suffix to the label. Required fields carry no asterisk; the
// control still gets required and aria-required.
export default function Field({ label, hint, error, required, optional, children, className = '' }) {
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
      <label htmlFor={controlId} className="text-[13px] font-medium text-ink">
        {label}
        {optional && !required && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>
      )}
    </div>
  );
}
