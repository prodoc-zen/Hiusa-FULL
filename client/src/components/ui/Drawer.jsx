import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import AccessibleOverlay from '../AccessibleOverlay';

const EXIT_DURATION_MS = 180;

export default function Drawer({ open, title, description, onClose, children, footer, width = 'max-w-md' }) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const exitTimerRef = useRef(null);

  useEffect(() => {
    if (open) {
      window.clearTimeout(exitTimerRef.current);
      setClosing(false);
      setRendered(true);
      return undefined;
    }

    if (!rendered) return undefined;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    exitTimerRef.current = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, prefersReducedMotion ? 0 : EXIT_DURATION_MS);

    return () => window.clearTimeout(exitTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!rendered) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[70] flex justify-end bg-navy-950/50 transition-opacity duration-150 ${closing ? 'opacity-0' : 'overlay-fade-in'}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <AccessibleOverlay
        label={title}
        labelledBy={title ? 'drawer-title' : undefined}
        onClose={onClose}
        closeOnBackdrop={false}
        baseClassName={`flex h-full w-full flex-col overflow-hidden ${closing ? 'drawer-slide-out' : 'drawer-slide-in'}`}
        className={`${width} border-l border-line bg-surface shadow-raised`}
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
      </AccessibleOverlay>
    </div>
  );
}
