import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Drawer({ open, title, description, onClose, children, footer, width = 'max-w-md' }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      const focusable = panelRef.current?.querySelector(
        '[data-autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      focusable?.focus?.();
    });

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-navy-950/50 overlay-fade-in"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'drawer-title' : undefined}
        className={`drawer-slide-in flex h-full w-full ${width} flex-col overflow-hidden border-l border-line bg-surface shadow-raised`}
      >
        {(title || onClose) && (
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title && <h2 id="drawer-title" className="text-base font-bold text-ink">{title}</h2>}
              {description && <p className="mt-1 text-sm font-medium text-ink-muted">{description}</p>}
            </div>
            {onClose && (
              <button
                type="button"
                aria-label="Close panel"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink"
              >
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-4">{footer}</footer>}
      </section>
    </div>
  );
}
