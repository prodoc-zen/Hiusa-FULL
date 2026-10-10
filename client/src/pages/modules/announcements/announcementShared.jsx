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

// The server keeps two fields: approval_status (draft, pending, approved, rejected) and is_published.
// An officer's announcement waits as pending until the Admin approves it, an Admin unpublishing
// puts it back to draft, and there is no archived state, so the stage is read from both fields.
export function announcementStage(announcement) {
  if (announcement?.approval_status === 'pending') return { key: 'pending', label: 'Waiting for Admin approval', color: 'yellow' };
  if (announcement?.approval_status === 'rejected') return { key: 'returned', label: 'Returned', color: 'red' };
  if (announcement?.is_published) return { key: 'published', label: 'Published', color: 'green' };
  return { key: 'draft', label: 'Draft', color: 'gray' };
}

export function AnnouncementStageChip({ announcement }) {
  const stage = announcementStage(announcement);
  return <Badge color={stage.color}>{stage.label}</Badge>;
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
