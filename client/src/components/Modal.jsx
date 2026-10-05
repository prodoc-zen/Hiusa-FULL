import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

    const previousFocus = document.activeElement;
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
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="app-overlay overlay-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-navy-950/55 p-4 backdrop-blur-sm sm:p-6"
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
        className={`modal-pop-in modal-surface flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-white/80 bg-surface shadow-raised sm:max-h-[calc(100dvh-3rem)]`}
      >
        {(title || description || onClose) && (
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
            <div>
              {title && <h2 id="modal-title" className="text-lg font-extrabold text-ink">{title}</h2>}
              {description && <p className="mt-1 text-sm font-medium leading-5 text-ink-muted">{description}</p>}
            </div>
            {onClose && (
              <button
                type="button"
                aria-label="Close modal"
                onClick={onClose}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-danger-tint hover:text-danger-strong"
              >
                <X size={17} />
              </button>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-5">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-subtle px-4 py-3 [&>button]:w-full sm:flex-row sm:flex-wrap sm:justify-end sm:px-5 sm:py-4 sm:[&>button]:w-auto">
            {footer}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
