import { useEffect, useRef } from 'react';

// Top-of-form summary shown after a failed submit. Each item with a fieldId links to its field and
// moves focus there. `attempt` counts submits; the summary takes focus once per submit (not while
// the user types and messages clear) so keyboard and screen reader users land on it.
export default function ErrorSummary({ items, attempt = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (attempt > 0) ref.current?.focus();
  }, [attempt]);

  if (!items.length) return null;

  function focusField(event, fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    event.preventDefault();
    field.focus();
  }

  return (
    <div ref={ref} tabIndex={-1} role="group" aria-labelledby="error-summary-title" className="rounded-control border border-danger-strong/30 bg-danger-tint p-4 text-sm text-ink">
      <h2 id="error-summary-title" className="text-sm font-semibold text-danger-strong">There is a problem</h2>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.fieldId || item.message}>
            {item.fieldId ? (
              <a href={`#${item.fieldId}`} onClick={(event) => focusField(event, item.fieldId)} className="font-medium text-danger-strong underline">{item.message}</a>
            ) : (
              <span className="font-medium text-danger-strong">{item.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
