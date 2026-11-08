import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Heart, Megaphone, Search } from 'lucide-react';
import { EmptyState, ErrorState, Input, PageHeader, SkeletonCard } from '../../../components/ui';
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
  return <article className="overflow-hidden rounded-card border border-line bg-surface">
    <header className="border-b border-line px-4 py-3 sm:px-5"><p className="text-sm font-semibold text-ink">{organizationName(announcement)}</p><p className="text-xs text-ink-muted">{new Date(announcement.published_at || announcement.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</p></header>
    <div className="px-4 py-4 sm:px-5"><h2 className="text-lg font-semibold text-ink">{formatDisplayText(announcement.title)}</h2><RichTextBody value={announcement.body} className="mt-2 text-sm leading-6 text-ink" /></div>
    {announcement.image_url && <img src={resolveAssetUrl(announcement.image_url)} alt={formatDisplayText(announcement.title)} loading="lazy" className="max-h-[640px] w-full border-y border-line object-contain" />}
    <footer className="px-4 py-3 sm:px-5"><button type="button" onClick={toggleReaction} disabled={busy} aria-pressed={Boolean(announcement.is_liked)} className={`inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 ${announcement.is_liked ? 'bg-brand/10 text-brand-700' : 'text-ink-muted-strong hover:bg-subtle'}`}><Heart size={18} fill={announcement.is_liked ? 'currentColor' : 'none'} /> {announcement.is_liked ? 'Liked' : 'Like'} <span aria-label={`${announcement.reactions_count || 0} reactions`}>{announcement.reactions_count || 0}</span></button>{error && <p role="alert" className="mt-2 text-xs text-danger-strong">{error}</p>}</footer>
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
  const hasFilters = Boolean(search.trim()) || category !== 'all';
  const clearFilters = () => { setSearch(''); setCategory('all'); };
  return <div className="space-y-5">
    <PageHeader />
    <div className="mx-auto w-full max-w-2xl space-y-4">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
      <label className="relative"><span className="sr-only">Search announcements</span><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-ink-muted" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search announcements" className="pl-9" /></label>
      <HiusaSelect filter aria-label="Announcement category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</HiusaSelect>
    </div>
    {loading && <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}
    {error && <ErrorState title="Could not load announcements" description="Check your connection and try again." onRetry={load} />}
    {!loading && !error && announcements.length === 0 && (hasFilters ? <EmptyState kind="filtered" title="No announcements match" description="Try a different search or category." onClearFilters={clearFilters} /> : <EmptyState icon={Megaphone} title="No announcements yet" description="Your officers post them here." />)}
    {!loading && !error && announcements.map((item) => <AnnouncementCard key={item.id} announcement={item} onReaction={updateReaction} />)}
    {!loading && !error && <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="announcements" />}
    </div>
  </div>;
}
