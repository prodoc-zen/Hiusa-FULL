import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function RulesDisclosure({ label, items, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-bold text-[#0B8ED0]"
      >
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {label}
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-slate-600">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
