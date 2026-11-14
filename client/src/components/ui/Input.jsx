import { forwardRef } from 'react';
import DateTimeInput from './DateTimeInput';

// A file picker keeps the box but takes its height from the button inside it (40px plus the 1px border), so the
// browser's grey default button is replaced by the app's own.
const BOX = 'w-full rounded-control border border-line bg-surface text-sm font-normal text-ink transition-colors duration-150 placeholder:text-ink-soft focus:border-brand-600 aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-soft';
const TEXT_BOX = `h-10 px-3 ${BOX}`;
const FILE_BOX = `overflow-hidden pr-3 font-sans text-ink-muted ${BOX} file:mr-3 file:h-10 file:cursor-pointer file:border-0 file:border-r file:border-line file:bg-subtle file:px-4 file:font-sans file:text-sm file:font-semibold file:text-brand-700`;

const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  const Component = ['date', 'time', 'datetime-local'].includes(props.type) ? DateTimeInput : 'input';
  return (
    <Component
      ref={ref}
      className={`${props.type === 'file' ? FILE_BOX : TEXT_BOX} ${className}`}
      {...props}
    />
  );
});

export default Input;
