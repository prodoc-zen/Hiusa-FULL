import { useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';

export default function TableFilterBar({
  searchValue = '',
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = 'Search records...',
  activeFilters = [],
  onClear,
  resultCount,
  resultLabel = 'records',
  children,
  actions,
  secondaryClassName = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSecondaryFilters = Boolean(children);
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1 lg:max-w-xl">
          <span className="sr-only">Search</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSearchSubmit?.();
            }}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-control border border-line bg-surface pl-9 pr-10 text-sm text-ink outline-none transition-colors duration-150 focus:border-brand-600 focus:ring-4 focus:ring-accent/15"
          />
          {searchValue && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange?.('')}
              className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-control text-ink-soft transition-colors duration-150 hover:bg-subtle hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </label>

        <div className="flex w-full flex-wrap items-center gap-2 [&>*]:flex-1 sm:w-auto sm:[&>*]:flex-none">
          {hasSecondaryFilters && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className={`inline-flex h-11 items-center gap-2 rounded-control border px-4 text-sm font-bold transition-colors duration-150 ${expanded || hasActiveFilters ? 'border-brand-600 bg-brand-50 text-navy-800' : 'border-line bg-surface text-ink-muted hover:bg-subtle'}`}
            >
              <SlidersHorizontal size={16} />
              Filters
              {hasActiveFilters && <span className="grid min-w-5 place-items-center rounded-full bg-navy-800 px-1.5 py-0.5 text-[10px] text-white">{activeFilters.length}</span>}
              <ChevronDown size={15} className={`transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          {actions}
        </div>

        {resultCount !== undefined && resultCount !== null && (
          <p className="text-xs font-semibold tabular-nums text-ink-muted lg:ml-auto">
            {resultCount} {resultLabel}
          </p>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2.5 sm:px-4">
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">Active</span>
          {activeFilters.map((filter) => (
            <span key={filter} className="max-w-full break-words rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-navy-800">{filter}</span>
          ))}
          {onClear && (
            <button type="button" onClick={onClear} className="min-h-8 px-2 text-xs font-bold text-brand-700 transition-colors duration-150 hover:text-navy-800 sm:ml-auto">
              Clear all
            </button>
          )}
        </div>
      )}

      {hasSecondaryFilters && expanded && (
        <div className="border-t border-line bg-subtle p-3 sm:p-4">
          <div className={secondaryClassName}>{children}</div>
        </div>
      )}
    </div>
  );
}
