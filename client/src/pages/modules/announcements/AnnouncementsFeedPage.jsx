import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Avatar, cn } from './announcementShared.jsx';
import { getAnnouncements } from '../../../services/announcementService';
import { getNotifications, markRead } from '../../../services/notificationService';

const ROLE_LABEL = { all: 'All Members', student: 'Students', officer: 'Officers', adviser: 'Advisers' };
const CATEGORY_LABEL = { general: 'General', election: 'Election', training: 'Training', events: 'Events', merchandise: 'Merchandise' };
const CATEGORY_OPTIONS = [
  { label: 'All Categories', value: 'all' },
  { label: 'General', value: 'general' },
  { label: 'Election', value: 'election' },
  { label: 'Training', value: 'training' },
  { label: 'Events', value: 'events' },
  { label: 'Merchandise', value: 'merchandise' },
];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AnnouncementsFeedPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    setLoading(true);
    setError(null);
    const params = categoryFilter === 'all' ? undefined : { category: categoryFilter };
    getAnnouncements(params)
      .then((res) => setAnnouncements(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError('Failed to load announcements.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [categoryFilter]);

  useEffect(() => {
    let cancelled = false;

    async function markAnnouncementAlertsAsRead() {
      try {
        const res = await getNotifications();
        const notifications = Array.isArray(res.data?.notifications) ? res.data.notifications : [];
        const unreadAnnouncementIds = notifications
          .filter((notification) => !notification.is_read && String(notification.title || '').startsWith('New Announcement:'))
          .map((notification) => notification.id);

        if (!cancelled && unreadAnnouncementIds.length > 0) {
          await Promise.all(unreadAnnouncementIds.map((id) => markRead(id)));
        }
      } catch {
        // Feed should still render even if notification syncing fails.
      }
    }

    markAnnouncementAlertsAsRead();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = announcements.filter(
    (a) => a.is_published && a.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements..."
            className="w-full rounded-xl border border-[#DDE7EF] bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#16C7F3]/30"
          />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-11 rounded-xl border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/30 sm:w-48">
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-400">No announcements to show.</p>
        </div>
      )}

      {!loading && !error && filtered.map((a) => (
        <div
          key={a.id}
          className="cursor-pointer rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition-colors hover:border-[#0B8ED0]/30"
          onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-sm font-bold leading-tight text-[#0F172A]">{a.title}</h3>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full bg-[#E6F6FD] px-2.5 py-0.5 text-[11px] font-bold text-[#0878B7]">
                {ROLE_LABEL[a.target_role] ?? a.target_role}
              </span>
              <span className="rounded-full border border-[#DDE7EF] bg-[#F8FBFD] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {CATEGORY_LABEL[a.category] ?? 'General'}
              </span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {expandedId === a.id ? a.body : `${(a.body || '').slice(0, 120)}...`}
          </p>
          <div className="mt-3 flex items-center gap-2 border-t border-[#EEF6FB] pt-3">
            <Avatar
              name={a.creator ? `${a.creator.first_name} ${a.creator.last_name}` : 'HIUSA'}
              size="sm"
            />
            <div>
              <p className="text-[10px] font-semibold text-slate-700">
                {a.creator ? `${a.creator.first_name} ${a.creator.last_name}` : 'HIUSA Admin'}
              </p>
              <p className="text-[10px] text-slate-400">{formatDate(a.created_at)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
