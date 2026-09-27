import { forwardRef } from 'react';

const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`h-11 w-full rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none transition-colors duration-150 placeholder:text-ink-soft focus:border-brand-600 focus:ring-4 focus:ring-accent/15 aria-invalid:border-danger aria-invalid:focus:ring-danger/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-soft ${className}`}
      {...props}
    />
  );
});

export default Input;
