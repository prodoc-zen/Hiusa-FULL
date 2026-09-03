import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, Megaphone, Search } from 'lucide-react';
import { Avatar } from './announcementShared.jsx';
import { getAnnouncements } from '../../../services/announcementService';
import { getNotifications, markRead } from '../../../services/notificationService';
import PaginationControls from '../../../components/PaginationControls';
import { listMeta, unwrapList } from '../../../services/pagination';

const ROLE_LABEL = { all: 'All Members', STUDENT: 'Students', SBO_OFFICER: 'SBO Officers', ADMIN: 'Admins', DEPARTMENT_HEAD: 'Department Heads' };
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
  return new Date(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
}

function Author({ announcement, inverted = false }) {
  const name = announcement.creator ? `${announcement.creator.first_name} ${announcement.creator.last_name}` : 'HIUSA Admin';
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={name} size="sm" />
      <div>
        <p className={`text-xs font-bold ${inverted ? 'text-white' : 'text-[#0F172A]'}`}>{name}</p>
        <p className={`text-[11px] ${inverted ? 'text-slate-300' : 'text-[#64748B]'}`}>{formatDate(announcement.created_at)}</p>
      </div>
    </div>
  );
}

export default function AnnouncementsFeedPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = {
      published_only: 1,
      page,
      search: search || undefined,
      ...(categoryFilter === 'all' ? {} : { category: categoryFilter }),
    };
    getAnnouncements(params)
      .then((res) => {
        setAnnouncements(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => setError('Failed to load announcements.'))
      .finally(() => setLoading(false));
  }, [categoryFilter, search, page]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, search]);

  useEffect(() => {
    let cancelled = false;
    async function markAnnouncementAlertsAsRead() {
      try {
        // /notifications now paginates at 20/page by default; the endpoint's
        // cap is 100 (NotificationController.php:14), so the sweep asks for
        // that directly rather than only ever clearing the newest 20.
        const res = await getNotifications({ per_page: 100 });
        const notifications = unwrapList(res.data);
        const unreadAnnouncementIds = notifications
          .filter((notification) => !notification.is_read && String(notification.title || '').startsWith('New Announcement:'))
          .map((notification) => notification.id);

        if (!cancelled && unreadAnnouncementIds.length > 0) {
          await Promise.all(unreadAnnouncementIds.map((id) => markRead(id)));
        }
      } catch {
        // Notification syncing must not block the feed.
      }
    }
    markAnnouncementAlertsAsRead();
    return () => { cancelled = true; };
  }, []);

  const filtered = announcements.filter((announcement) => announcement.is_published);
  const featured = filtered[0];
  const remaining = filtered.slice(1);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><Megaphone size={21} /></div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">HIUSA bulletin</p>
            <h1 className="mt-1 text-2xl font-black text-[#0F172A] sm:text-3xl">Announcements Feed</h1>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">Updates, schedules, and important notices from your organization—all in one readable feed.</p>
          </div>
          <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-left lg:text-right">
            <p className="text-2xl font-black text-[#0B8ED0]">{meta.total}</p>
            <p className="text-xs font-bold text-[#64748B]">Published update{meta.total === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative"><span className="sr-only">Search announcements</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search announcements..." className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" /></label>
          <select aria-label="Announcement category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0B8ED0]">
            {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </section>

      {loading && <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading announcements">{[1, 2, 3].map((item) => <div key={item} className="h-72 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />)}<span className="sr-only">Loading announcements...</span></div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center"><p className="text-sm font-semibold text-red-700">{error}</p><button type="button" onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button></div>}
      {!loading && !error && filtered.length === 0 && <div className="rounded-xl border border-dashed border-[#DDE7EF] bg-white p-10 text-center"><Megaphone size={36} className="mx-auto text-[#94A3B8]" /><h2 className="mt-3 text-base font-bold text-[#0F172A]">No announcements to show</h2><p className="mt-1 text-sm text-[#64748B]">Try another search or category.</p></div>}

      {!loading && !error && featured && (
        <article className="grid overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
          <div className="bg-[#0B1831] p-5 text-white sm:p-7 lg:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold">Latest announcement</span>
              <span className="rounded-full border border-white/20 px-3 py-1 text-[11px] font-bold">{CATEGORY_LABEL[featured.category] || 'General'}</span>
            </div>
            <h2 className="mt-5 text-2xl font-black leading-tight sm:text-3xl">{featured.title}</h2>
            <p className={`mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200 ${expandedId === featured.id ? '' : 'line-clamp-4'}`}>{featured.body}</p>
            <button type="button" onClick={() => setExpandedId(expandedId === featured.id ? null : featured.id)} className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-[#0B1831] hover:bg-[#EEF6FB]">{expandedId === featured.id ? 'Show less' : 'Read full update'} <ArrowUpRight size={15} /></button>
          </div>
          <div className="flex flex-col justify-between p-5 sm:p-7">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Audience</p>
              <p className="mt-2 text-xl font-black text-[#0F172A]">{ROLE_LABEL[featured.target_role] ?? featured.target_role}</p>
              <div className="mt-5 flex items-start gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-xs leading-5 text-[#64748B]"><CalendarDays size={15} className="mt-0.5 shrink-0 text-[#0B8ED0]" />Published {formatDate(featured.created_at)}</div>
            </div>
            <div className="mt-8 border-t border-[#DDE7EF] pt-4"><Author announcement={featured} /></div>
          </div>
        </article>
      )}

      {!loading && !error && remaining.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black text-[#0F172A]">More updates</h2><span className="text-xs font-semibold text-[#64748B]">{remaining.length} item{remaining.length === 1 ? '' : 's'}</span></div>
          <div className="grid gap-4 md:grid-cols-2">
            {remaining.map((announcement) => (
              <article key={announcement.id} className="flex min-h-64 flex-col rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/40 sm:p-6">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#EEF6FB] px-2.5 py-1 text-[10px] font-bold uppercase text-[#0B8ED0]">{CATEGORY_LABEL[announcement.category] || 'General'}</span><span className="text-[11px] font-semibold text-[#64748B]">For {ROLE_LABEL[announcement.target_role] ?? announcement.target_role}</span></div>
                <h3 className="mt-4 text-lg font-black leading-snug text-[#0F172A]">{announcement.title}</h3>
                <p className={`mt-3 flex-1 whitespace-pre-wrap text-sm leading-6 text-[#64748B] ${expandedId === announcement.id ? '' : 'line-clamp-4'}`}>{announcement.body}</p>
                <button type="button" onClick={() => setExpandedId(expandedId === announcement.id ? null : announcement.id)} className="mt-4 inline-flex h-10 w-fit items-center gap-1.5 text-xs font-bold text-[#0B8ED0] hover:underline">{expandedId === announcement.id ? 'Show less' : 'Read more'} <ArrowUpRight size={13} /></button>
                <div className="mt-4 border-t border-[#DDE7EF] pt-4"><Author announcement={announcement} /></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && (
        <PaginationControls
          currentPage={meta.currentPage}
          totalItems={meta.total}
          pageSize={meta.perPage}
          onPageChange={setPage}
          label="announcements"
        />
      )}
    </div>
  );
}
