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
    <div className="flex items-center justify-between border-t border-[#DDE7EF] px-5 py-3">
      <p className="text-xs font-medium text-slate-400">
        Showing <span className="font-bold text-slate-600">{from}-{to}</span> of{' '}
        <span className="font-bold text-slate-600">{totalItems}</span> {label}
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <label className="mr-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
            Per page
            <select aria-label={`${label} per page`} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="h-9 rounded-lg border border-[#DDE7EF] bg-white px-2 font-bold text-slate-700">
              {(pageSizeOptions || [10, 25, 50]).map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        )}
        <button
          type="button"
          aria-label={`Previous page of ${label}`}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="hidden items-center gap-1 sm:flex">
          {visiblePages.map((page, index) => (
            <span key={page} className="contents">
              {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
              <button type="button" aria-label={`Page ${page} of ${label}`} aria-current={page === currentPage ? 'page' : undefined} onClick={() => onPageChange(page)} className={`h-9 min-w-9 rounded-lg px-2 text-xs font-bold ${page === currentPage ? 'bg-[#0B8ED0] text-white' : 'border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]'}`}>{page}</button>
            </span>
          ))}
        </div>
        <span className="px-1 text-xs font-bold tabular-nums text-[#0F172A] sm:hidden">{currentPage}/{totalPages}</span>
        <button
          type="button"
          aria-label={`Next page of ${label}`}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
