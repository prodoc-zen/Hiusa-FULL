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
    <div className="border-b border-[#DDE7EF] bg-white">
      <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1 lg:max-w-xl">
          <span className="sr-only">Search</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSearchSubmit?.();
            }}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-10 text-sm text-[#0F172A] outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
          {searchValue && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange?.('')}
              className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#F8FBFD] hover:text-[#0F2F62]"
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
              className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-bold transition ${expanded || hasActiveFilters ? 'border-[#0B8ED0] bg-[#E6F6FD] text-[#0F2F62]' : 'border-[#DDE7EF] bg-white text-slate-600 hover:bg-[#F8FBFD]'}`}
            >
              <SlidersHorizontal size={16} />
              Filters
              {hasActiveFilters && <span className="grid min-w-5 place-items-center rounded-full bg-[#0F2F62] px-1.5 py-0.5 text-[10px] text-white">{activeFilters.length}</span>}
              <ChevronDown size={15} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          {actions}
        </div>

        {resultCount !== undefined && resultCount !== null && (
          <p className="text-xs font-semibold tabular-nums text-slate-500 lg:ml-auto">
            {resultCount} {resultLabel}
          </p>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#EEF6FB] px-3 py-2.5 sm:px-4">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Active</span>
          {activeFilters.map((filter) => (
            <span key={filter} className="max-w-full break-words rounded-full border border-[#C9E8F7] bg-[#F2FAFE] px-2.5 py-1 text-xs font-semibold text-[#0F2F62]">{filter}</span>
          ))}
          {onClear && (
            <button type="button" onClick={onClear} className="min-h-8 px-2 text-xs font-bold text-[#0878B7] hover:text-[#0F2F62] sm:ml-auto">
              Clear all
            </button>
          )}
        </div>
      )}

      {hasSecondaryFilters && expanded && (
        <div className="border-t border-[#DDE7EF] bg-[#F8FBFD] p-3 sm:p-4">
          <div className={secondaryClassName}>{children}</div>
        </div>
      )}
    </div>
  );
}
