import { SearchX, ShieldAlert } from 'lucide-react';
import Button from './Button';

function FacetedShape({ children }) {
  return (
    <div className="relative grid h-20 w-20 shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <polygon points="40,4 76,30 62,74 18,74 4,30" className="fill-brand-50" />
        <polygon points="40,4 76,30 40,42" className="fill-brand-100" />
        <polygon points="40,42 76,30 62,74" className="fill-navy-800/10" />
      </svg>
      <span className="relative text-brand-600">{children}</span>
    </div>
  );
}

export default function EmptyState({ kind = 'first-run', icon: Icon, title, description, action, query, onClearFilters, className = '' }) {
  if (kind === 'filtered') {
    return (
      <div className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`}>
        <FacetedShape><SearchX size={30} strokeWidth={1.75} aria-hidden="true" /></FacetedShape>
        <div>
          <p className="text-base font-bold text-ink">{query ? `No results for "${query}"` : (title || 'No results')}</p>
          {description && <p className="mx-auto mt-1 max-w-sm text-sm font-medium text-ink-muted">{description}</p>}
        </div>
        {action || (onClearFilters && (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>Clear filters</Button>
        ))}
      </div>
    );
  }

  if (kind === 'restricted') {
    return (
      <div className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`}>
        <FacetedShape><ShieldAlert size={30} strokeWidth={1.75} aria-hidden="true" /></FacetedShape>
        <div>
          <p className="text-base font-bold text-ink">{title || 'Restricted'}</p>
          {description && <p className="mx-auto mt-1 max-w-sm text-sm font-medium text-ink-muted">{description}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-4 px-6 py-14 text-center ${className}`}>
      <FacetedShape>{Icon ? <Icon size={34} strokeWidth={1.75} aria-hidden="true" /> : null}</FacetedShape>
      <div>
        <p className="text-lg font-bold text-ink">{title}</p>
        {description && <p className="mx-auto mt-1.5 max-w-sm text-sm font-medium text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
