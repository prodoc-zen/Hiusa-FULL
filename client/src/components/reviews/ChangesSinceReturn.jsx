// What the organization changed after a reviewer returned its work, or after an edit took back the reviewer's own
// approval (since="approved"), as the server lists it: [{ field, label, before?, after? }].
// A change shows its before and after only when the server sent both.
// Reviewers only: the server never sends the list to the organization, and with no list this renders nothing.
function blank(value) {
  return value === '' ? 'blank' : value;
}

export default function ChangesSinceReturn({ changes, since }) {
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const heading = since === 'approved' ? 'Changed since you approved it' : 'Changed since you returned it';
  return (
    <section aria-label={heading} className="border-l-2 border-brand-600 bg-brand-50 px-3 py-2">
      <h3 className="text-xs font-semibold text-ink-muted-strong">{`${heading}:`}</h3>
      <ul className="mt-1 space-y-0.5 text-sm text-ink">
        {changes.map((change) => (
          <li key={change.field} className="break-words">
            <span className="font-medium">{change.label}</span>
            {change.before !== undefined && change.after !== undefined && (
              <span className="text-ink-muted-strong">{`: ${blank(change.before)} to ${blank(change.after)}`}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
