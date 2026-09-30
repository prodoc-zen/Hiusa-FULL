import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export default function TableRowActions({ subject, actions, label = 'Actions' }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const available = actions.filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    const closeOutside = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && menuRef.current?.contains(document.activeElement)) {
        const items = Array.from(menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)'));
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    const closeOnFocusLeave = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnMove = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', closeOnFocusLeave);
    window.addEventListener('resize', closeOnMove);
    window.addEventListener('scroll', closeOnMove, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', closeOnFocusLeave);
      window.removeEventListener('resize', closeOnMove);
      window.removeEventListener('scroll', closeOnMove, true);
    };
  }, [open]);

  if (available.length === 0) return null;

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(224, window.innerWidth - 24);
    const height = Math.min(62 + available.length * 44, window.innerHeight - 24);
    const above = window.innerHeight - rect.bottom < height + 16 && rect.top > height;
    setPosition({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 12)),
    });
    setOpen(true);
  };

  return (
    <div className="flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Actions for ${subject}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={toggle}
        className={`grid h-10 w-10 place-items-center rounded-lg border bg-white text-[#0F2F62] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] ${open ? 'border-[#0B8ED0] bg-[#EEF6FB]' : 'border-[#DDE7EF] hover:border-[#0B8ED0] hover:bg-[#F8FBFD]'}`}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${label} for ${subject}`}
          style={position}
          className="fixed z-[100] max-h-[calc(100vh-24px)] w-56 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-2 shadow-[0_18px_50px_-18px_rgba(15,23,42,0.28)]"
        >
          <div className="mb-1 border-b border-slate-100 px-2.5 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#0878B7]">{label}</p>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{subject}</p>
          </div>
          {available.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => { setOpen(false); triggerRef.current?.focus(); action.onClick(); }}
                className={`group flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] disabled:cursor-not-allowed disabled:opacity-50 ${action.danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-[#F8FBFD] hover:text-[#0878B7]'}`}
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${action.danger ? 'border-red-200 bg-red-50 text-red-700' : 'border-[#DDE7EF] bg-[#EEF6FB] text-[#0F2F62]'}`}>
                  {Icon && <Icon size={14} strokeWidth={2.1} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">{action.label}</span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-200 group-hover:bg-[#0B8ED0]" aria-hidden="true" />
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
