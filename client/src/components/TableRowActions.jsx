import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { dashboardPopupLeft, dashboardPopupTop } from '../utils/dashboardPopupPosition';

export default function TableRowActions({ subject, actions, label = 'Actions' }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const available = actions.filter(Boolean);
  const itemCount = available.length;

  const measure = useCallback(() => {
    const rect = triggerRef.current.getBoundingClientRect();
    const minLeft = dashboardPopupLeft();
    const width = Math.min(224, window.innerWidth - 24);
    const minTop = dashboardPopupTop();
    const height = Math.min(62 + itemCount * 44, Math.max(44, window.innerHeight - minTop - 12));
    const above = window.innerHeight - rect.bottom < height + 16 && rect.top - height - 8 >= minTop;
    return {
      visible: rect.bottom > minTop && rect.top < window.innerHeight,
      position: {
        left: Math.max(minLeft, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: Math.max(minTop, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 12)),
      },
    };
  }, [itemCount]);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.showPopover?.();
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
    const closeOnResize = () => setOpen(false);
    // The menu is portaled and fixed, so it follows its trigger as the page scrolls
    // and only closes once the trigger itself has left the visible area.
    const followTrigger = (event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      const { visible, position: next } = measure();
      if (visible) setPosition(next);
      else setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', closeOnFocusLeave);
    window.addEventListener('resize', closeOnResize);
    window.addEventListener('scroll', followTrigger, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', closeOnFocusLeave);
      window.removeEventListener('resize', closeOnResize);
      window.removeEventListener('scroll', followTrigger, true);
    };
  }, [open, measure]);

  if (available.length === 0) return null;

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setPosition(measure().position);
    setPortalContainer(triggerRef.current.closest('[role="dialog"]') || document.body);
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
        className={`grid h-11 w-11 place-items-center md:h-10 md:w-10 rounded-control border bg-surface text-ink-muted transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${open ? 'border-brand-600 bg-subtle text-ink' : 'border-line hover:bg-subtle hover:text-ink'}`}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          popover={typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype ? 'manual' : undefined}
          id={menuId}
          role="menu"
          aria-label={`${label} for ${subject}`}
          style={{ margin: 0, bottom: 'auto', right: 'auto', ...position }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}
          className="fixed z-[100] max-h-[calc(100dvh-var(--dashboard-navbar-bottom,0px)-20px)] w-56 max-w-[calc(100vw-24px)] overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-raised"
        >
          <div className="mb-1 border-b border-line-soft px-2.5 py-2">
            <p className="text-xs font-medium text-ink-muted">{label}</p>
            <p className="mt-0.5 truncate text-xs font-normal text-ink-muted">{subject}</p>
          </div>
          {available.map((action) => {
            const Icon = action.icon;
            const ActionElement = action.to && !action.disabled ? Link : 'button';
            return (
              <ActionElement
                key={action.label}
                {...(ActionElement === Link ? { to: action.to } : { type: 'button', disabled: action.disabled })}
                role="menuitem"
                onClick={(event) => { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); action.onClick?.(); }}
                className={`flex min-h-11 w-full items-center gap-3 rounded-control px-2.5 text-left text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${action.danger ? 'text-danger-strong hover:bg-danger-tint' : 'text-ink hover:bg-subtle'}`}
              >
                <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center ${action.danger ? 'text-danger-strong' : 'text-ink-muted'}`}>
                  {Icon && <Icon size={16} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">{action.label}</span>
              </ActionElement>
            );
          })}
        </div>,
        portalContainer || document.body,
      )}
    </div>
  );
}
