import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

const Select = forwardRef(function Select({ className = '', children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={`h-11 w-full appearance-none rounded-control border border-line bg-surface px-3 pr-9 text-sm font-medium text-ink outline-none transition-colors duration-150 focus:border-brand-600 focus:ring-4 focus:ring-accent/15 aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-soft ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
    </div>
  );
});

export default Select;
