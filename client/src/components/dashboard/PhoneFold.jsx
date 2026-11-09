import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Keeps a section's body out of the way on a phone until the person taps. From the sm breakpoint up it
 * renders the body as it always did and no button. The section keeps its own heading above this.
 */
export default function PhoneFold({ label, hideLabel = 'Hide', children, className = '' }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-4 text-left text-sm font-medium text-brand-700 hover:bg-subtle sm:hidden ${className}`}
      >
        {open ? hideLabel : label}
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={bodyId} className={open ? undefined : 'max-sm:hidden'}>{children}</div>
    </>
  );
}
