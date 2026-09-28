import { forwardRef } from 'react';

const Textarea = forwardRef(function Textarea({ className = '', rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm font-medium leading-5 text-ink outline-none transition-colors duration-150 placeholder:text-ink-soft focus:border-brand-600 focus:ring-4 focus:ring-accent/15 aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-soft ${className}`}
      {...props}
    />
  );
});

export default Textarea;
