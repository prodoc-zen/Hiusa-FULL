// Left-aligned, one title, one sentence, at most one action. "none yet" (first-run)
// and "none match" (filtered) are separate kinds so a filter never reads as an empty system.
export default function EmptyState({ kind = 'first-run', icon: Icon, title, description, action, query, onClearFilters, className = '' }) {
  const isFiltered = kind === 'filtered' || kind === 'none-match';
  const isRestricted = kind === 'restricted';

  let heading = title;
  if (isFiltered) heading = query ? `No results for "${query}"` : (title || 'No results');
  else if (isRestricted) heading = title || 'Restricted';

  let control = null;
  if (isFiltered) {
    control = action || (onClearFilters && (
      <button
        type="button"
        onClick={onClearFilters}
        className="rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
      >
        Clear filters
      </button>
    ));
  } else if (!isRestricted) {
    control = action;
  }

  return (
    <div className={`flex flex-col items-start gap-2 py-8 ${className}`}>
      {Icon && <Icon size={24} strokeWidth={1.75} className="text-ink-muted" aria-hidden="true" />}
      <div>
        {heading && <p className="text-sm font-semibold text-ink">{heading}</p>}
        {description && <p className="mt-1 max-w-prose text-sm font-normal text-ink-muted">{description}</p>}
      </div>
      {control}
    </div>
  );
}
