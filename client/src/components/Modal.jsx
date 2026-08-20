import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
  maxWidth = 'max-w-2xl',
}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnEscape]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const preferredFocus = panelRef.current?.querySelector(
      '[data-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    const firstFocus = panelRef.current?.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    preferredFocus?.focus?.();
    if (!preferredFocus) {
      firstFocus?.focus?.();
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        onCloseRef.current?.();
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(panelRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0B1831]/55 p-4 backdrop-blur-sm transition-opacity duration-200"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`flex max-h-[calc(100vh-2rem)] w-full ${maxWidth} scale-100 flex-col overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-2xl shadow-[#0B1831]/25 transition duration-200`}
      >
        {(title || description || onClose) && (
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#DDE7EF] px-5 py-4">
            <div>
              {title && <h2 id="modal-title" className="text-lg font-extrabold text-[#0F172A]">{title}</h2>}
              {description && <p className="mt-1 text-sm font-medium leading-5 text-slate-500">{description}</p>}
            </div>
            {onClose && (
              <button
                type="button"
                aria-label="Close modal"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <X size={17} />
              </button>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[#DDE7EF] bg-[#F8FBFD] px-5 py-4">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
