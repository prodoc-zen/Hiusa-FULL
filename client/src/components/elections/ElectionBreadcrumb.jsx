import { ChevronLeft } from 'lucide-react';

const statusStyles = {
  upcoming: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function ElectionBreadcrumb({ election, onClear }) {
  const isActive = election?.status === 'active';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#DDE7EF] bg-white p-3.5 shadow-sm">
      <button
        onClick={onClear}
        className="flex items-center gap-1.5 text-[#0B8ED0] text-xs font-semibold hover:underline shrink-0 cursor-pointer bg-transparent border-none p-0 outline-none"
      >
        <ChevronLeft size={14} />
        All Elections
      </button>
      <span className="text-slate-300">/</span>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isActive && (
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        )}
        <span className="text-sm font-bold text-[#0F172A] truncate">
          {election?.title}
        </span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize shrink-0 ${
            statusStyles[election?.status] || statusStyles.closed
          }`}
        >
          {election?.status}
        </span>
      </div>
      <span className="text-[10px] text-[#94A3B8] ml-auto shrink-0 hidden sm:block">
        {new Date(election?.start_time).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}{' '}
        —{' '}
        {new Date(election?.end_time).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </span>
    </div>
  );
}
