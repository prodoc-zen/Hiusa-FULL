import { Plus } from 'lucide-react';

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function Badge({ color, children }) {
  const map = {
    blue: 'bg-[#E6F6FD] text-[#0F2F62]',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-amber-100 text-amber-800',
    purple: 'bg-[#E6F6FD] text-[#0F2F62]',
    gray: 'bg-gray-100 text-gray-700',
    orange: 'bg-amber-100 text-amber-800',
    teal: 'bg-[#E6F6FD] text-[#0F2F62]',
  };

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', map[color] || map.gray)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const map = {
    Published: 'green',
    Draft: 'gray',
    Scheduled: 'blue',
  };

  return <Badge color={map[status] || 'gray'}>{status}</Badge>;
}

export function SectionHeader({ title, sub = null, action = null, onAction = null }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-[#0F172A]">
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {action && (
        <button
          onClick={onAction}
          className="flex items-center gap-1.5 rounded-lg bg-[#0878B7] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0F2F62]"
        >
          <Plus size={15} />
          {action}
        </button>
      )}
    </div>
  );
}

export function Avatar({ name, size = 'sm', color = null }) {
  const safeName = name || '?';
  const initials = safeName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  const colors = ['bg-[#0878B7]', 'bg-[#0B8ED0]', 'bg-[#0F2F62]', 'bg-[#0B1831]'];
  const bg = color || colors[safeName.charCodeAt(0) % colors.length];
  const sizeClass = size === 'lg' ? 'h-12 w-12 text-base' : size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs';

  return <div className={cn('flex shrink-0 items-center justify-center rounded-full font-bold text-white', sizeClass, bg)}>{initials}</div>;
}
