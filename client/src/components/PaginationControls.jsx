import HiusaSelect from './ui/Select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PaginationControls({
  currentPage,
  totalItems,
  pageSize = 10,
  onPageChange,
  label = 'items',
  pageSizeOptions,
  onPageSizeChange,
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);

  if (totalItems <= pageSize && !onPageSizeChange) {
    return null;
  }

  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="text-center text-xs font-normal text-ink-muted sm:text-left">
        Showing <span className="font-semibold tabular-nums text-ink">{from}-{to}</span> of{' '}
        <span className="font-semibold tabular-nums text-ink">{totalItems}</span> {label}
      </p>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-xs font-medium text-ink-muted sm:mr-2">
            Per page
            <HiusaSelect aria-label={`${label} per page`} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="h-9 rounded-control border border-line bg-surface px-2 font-medium text-ink">
              {(pageSizeOptions || [10, 25, 50]).map((size) => <option key={size} value={size}>{size}</option>)}
            </HiusaSelect>
          </label>
        )}
        <button
          type="button"
          aria-label={`Previous page of ${label}`}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="hidden items-center gap-1 sm:flex">
          {visiblePages.map((page, index) => (
            <span key={page} className="contents">
              {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-ink-muted">…</span>}
              <button
                type="button"
                aria-label={`Page ${page} of ${label}`}
                aria-current={page === currentPage ? 'page' : undefined}
                onClick={() => onPageChange(page)}
                className={`h-10 min-w-10 rounded-control px-2 text-xs font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100 ${page === currentPage ? 'bg-brand-700 text-white' : 'border border-line text-ink-muted hover:bg-subtle'}`}
              >
                {page}
              </button>
            </span>
          ))}
        </div>
        <span className="px-1 text-xs font-semibold tabular-nums text-ink sm:hidden">{currentPage}/{totalPages}</span>
        <button
          type="button"
          aria-label={`Next page of ${label}`}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
