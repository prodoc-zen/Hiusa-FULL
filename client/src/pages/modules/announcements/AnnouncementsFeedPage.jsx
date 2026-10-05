import { useCallback, useEffect, useState } from 'react';
import { Heart, Search } from 'lucide-react';
import { getAnnouncements, setAnnouncementReaction } from '../../../services/announcementService';
import { getNotifications, markRead } from '../../../services/notificationService';
import PaginationControls from '../../../components/PaginationControls';
import { listMeta, unwrapList } from '../../../services/pagination';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { RichTextBody } from '../../../components/RichText';

const categories = ['general', 'election', 'training', 'events', 'merchandise'];

function organizationName(announcement) {
  if (announcement.announcement_source === 'SAO') return announcement.source_organization?.name || 'Student Affairs Office';
  return announcement.organization?.name || 'HIUSA';
}

function AnnouncementCard({ announcement, onReaction }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggleReaction() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await setAnnouncementReaction(announcement.id, !announcement.is_liked);
      onReaction(announcement.id, result.data);
    } catch { setError('Could not save your reaction. Try again.'); }
    finally { setBusy(false); }
  }
  return <article className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
    <header className="border-b border-[#DDE7EF] px-4 py-3 sm:px-5"><p className="text-sm font-bold text-[#0F172A]">{organizationName(announcement)}</p><p className="text-xs text-[#64748B]">{new Date(announcement.published_at || announcement.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</p></header>
    <div className="px-4 py-4 sm:px-5"><h2 className="text-lg font-bold text-[#0F172A]">{announcement.title}</h2><RichTextBody value={announcement.body} className="mt-2 text-sm leading-6 text-[#0F172A]" /></div>
    {announcement.image_url && <img src={resolveAssetUrl(announcement.image_url)} alt={announcement.title} loading="lazy" className="max-h-[640px] w-full border-y border-[#DDE7EF] object-contain" />}
    <footer className="px-4 py-3 sm:px-5"><button type="button" onClick={toggleReaction} disabled={busy} aria-pressed={Boolean(announcement.is_liked)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] disabled:opacity-50 ${announcement.is_liked ? 'bg-red-50 text-red-700' : 'text-[#0F2F62] hover:bg-[#EEF6FB]'}`}><Heart size={18} fill={announcement.is_liked ? 'currentColor' : 'none'} /> {announcement.is_liked ? 'Liked' : 'Like'} <span aria-label={`${announcement.reactions_count || 0} reactions`}>{announcement.reactions_count || 0}</span></button>{error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</footer>
  </article>;
}

export default function AnnouncementsFeedPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await getAnnouncements({ published_only: 1, page, search: search || undefined, category: category === 'all' ? undefined : category });
      setAnnouncements(unwrapList(response.data)); setMeta(listMeta(response.data));
    } catch { setError('Could not load announcements.'); }
    finally { setLoading(false); }
  }, [page, search, category]);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { setPage(1); }, [search, category]);
  useEffect(() => {
    let cancelled = false;
    getNotifications({ per_page: 100 }).then((response) => {
      if (cancelled) return;
      const ids = unwrapList(response.data).filter((n) => !n.is_read && String(n.title || '').startsWith('New Announcement:')).map((n) => n.id);
      return Promise.all(ids.map(markRead));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const updateReaction = (id, result) => setAnnouncements((current) => current.map((item) => item.id === id ? { ...item, ...result } : item));
  return <div className="mx-auto w-full max-w-2xl space-y-4">
    <section className="rounded-lg border border-[#DDE7EF] bg-white p-4 sm:p-5"><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]"><label className="relative"><span className="sr-only">Search announcements</span><Search size={16} className="absolute left-3 top-3.5 text-[#64748B]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search announcements" className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm focus:border-[#0B8ED0] focus:outline-none focus:ring-4 focus:ring-[#16C7F3]/15" /></label><select aria-label="Announcement category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:outline-none"><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></div></section>
    {loading && <div role="status" className="rounded-lg border border-[#DDE7EF] bg-white p-8 text-center text-sm text-[#64748B]">Loading announcements...</div>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Try again</button></div>}
    {!loading && !error && announcements.length === 0 && <div className="rounded-lg border border-[#DDE7EF] bg-white p-8 text-center text-sm text-[#64748B]">No announcements match your search.</div>}
    {!loading && !error && announcements.map((item) => <AnnouncementCard key={item.id} announcement={item} onReaction={updateReaction} />)}
    {!loading && !error && <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="announcements" />}
  </div>;
}
