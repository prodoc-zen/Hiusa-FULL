// A hand-built table that becomes one block per row below 768px, so a table that carries its own
// actions needs no horizontal scroll at 390px. Each td gets data-label with its column header.
export const TABLE = 'w-full text-left text-sm max-md:block';
export const THEAD = 'bg-subtle text-xs font-semibold text-ink-muted max-md:sr-only';
export const TH = 'whitespace-nowrap px-4 py-2.5';
export const TBODY = 'max-md:block';
export const TR = 'border-b border-line-soft max-md:flex max-md:flex-col max-md:gap-1 max-md:py-3';
export const TD = 'px-4 py-2.5 align-middle max-md:flex max-md:items-start max-md:justify-between max-md:gap-3 max-md:px-4 max-md:py-1 max-md:text-right before:text-xs before:font-semibold before:text-ink-muted before:content-[attr(data-label)] md:before:hidden';
