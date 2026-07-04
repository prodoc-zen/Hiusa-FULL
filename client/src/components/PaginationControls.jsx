import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PaginationControls({
  currentPage,
  totalItems,
  pageSize = 10,
  onPageChange,
  label = 'items',
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);

  if (totalItems <= pageSize) {
    return null;
  }

  return (
    <div className="flex items-center justify-between border-t border-[#DDE7EF] px-5 py-3">
      <p className="text-xs font-medium text-slate-400">
        Showing <span className="font-bold text-slate-600">{from}-{to}</span> of{' '}
        <span className="font-bold text-slate-600">{totalItems}</span> {label}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="px-2 text-[13px] font-bold tabular-nums text-[#0F172A]">
          {currentPage} / {totalPages}
        </span>
        <button
          type="button"
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
