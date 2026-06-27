import { Plus } from 'lucide-react';

export const ANNOUNCEMENTS_DATA = [
  {
    id: 1,
    title: 'General Assembly - Second Semester',
    audience: 'All Members',
    status: 'Published',
    date: 'Jun 20, 2025',
    views: 198,
    category: 'General',
    body: 'All members are required to attend the second semester general assembly to discuss upcoming activities, financial reports, and officer elections.',
  },
  {
    id: 2,
    title: 'Officer Training Workshop Sign-Up',
    audience: 'Officers',
    status: 'Published',
    date: 'Jun 18, 2025',
    views: 45,
    category: 'Training',
    body: 'Officers are encouraged to sign up for the leadership training workshop happening on July 5. Slots are limited to 30 participants.',
  },
  {
    id: 3,
    title: 'Merchandise Pre-Order Now Open',
    audience: 'All Members',
    status: 'Published',
    date: 'Jun 15, 2025',
    views: 312,
    category: 'Merchandise',
    body: 'HIUSA merchandise pre-orders are now open. Order your org shirt, lanyard, tote bag, and other items. Payment deadline is June 30.',
  },
  {
    id: 4,
    title: 'Elections Campaign Period Guidelines',
    audience: 'All Members',
    status: 'Draft',
    date: 'Jun 22, 2025',
    views: 0,
    category: 'Elections',
    body: 'The official campaign period runs from June 18 to June 20. Candidates must follow the posted guidelines.',
  },
  {
    id: 5,
    title: 'Budget Review Meeting - Officers',
    audience: 'Officers',
    status: 'Draft',
    date: 'Jun 23, 2025',
    views: 0,
    category: 'Finance',
    body: 'Officers are invited to the Q2 budget review meeting on June 24 at 3PM via MS Teams.',
  },
];

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function Badge({ color, children }) {
  const map = {
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    purple: 'bg-purple-100 text-purple-800',
    gray: 'bg-gray-100 text-gray-700',
    orange: 'bg-orange-100 text-orange-800',
    teal: 'bg-teal-100 text-teal-800',
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
        <h2 className="text-lg font-bold text-slate-800" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {action && (
        <button
          onClick={onAction}
          className="flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
        >
          <Plus size={15} />
          {action}
        </button>
      )}
    </div>
  );
}

export function Avatar({ name, size = 'sm', color = null }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-red-500', 'bg-yellow-500', 'bg-indigo-500', 'bg-pink-500'];
  const bg = color || colors[name.charCodeAt(0) % colors.length];
  const sizeClass = size === 'lg' ? 'h-12 w-12 text-base' : size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs';

  return <div className={cn('flex shrink-0 items-center justify-center rounded-full font-bold text-white', sizeClass, bg)}>{initials}</div>;
}
