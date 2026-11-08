import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Search } from 'lucide-react';
import { EmptyState, ErrorState, Input, PageHeader, SkeletonCard } from '../../../components/ui';
import { getAnnouncements } from '../../../services/announcementService';
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

// The source shows only when the list mixes sources. A member of one organization would
// otherwise read the same long name above every post.
function AnnouncementCard({ announcement, showSource }) {
  const posted = new Date(announcement.published_at || announcement.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' });
  return <article className="rounded-card border border-line bg-surface px-4 py-4 sm:px-5">
    <h2 className="text-base font-semibold text-ink sm:text-lg">{formatDisplayText(announcement.title)}</h2>
    <p className="mt-0.5 text-xs text-ink-muted">{posted}{showSource ? ` · ${organizationName(announcement)}` : ''}</p>
    <RichTextBody value={announcement.body} className="mt-3 max-w-[75ch] text-sm leading-6 text-ink" />
    {announcement.image_url && <img src={resolveAssetUrl(announcement.image_url)} alt={formatDisplayText(announcement.title)} loading="lazy" className="mt-4 max-h-[480px] w-full rounded-control border border-line object-contain" />}
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
  const showSource = new Set(announcements.map(organizationName)).size > 1;
  const hasFilters = Boolean(search.trim()) || category !== 'all';
  const clearFilters = () => { setSearch(''); setCategory('all'); };
  return <div className="space-y-5">
    <PageHeader title="Announcements" />
    <div className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
      <label className="relative"><span className="sr-only">Search announcements</span><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-ink-muted" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search announcements" className="pl-9" /></label>
      <HiusaSelect filter aria-label="Announcement category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</HiusaSelect>
    </div>
    {loading && <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}
    {error && <ErrorState title="Could not load announcements" description="Check your connection and try again." onRetry={load} />}
    {!loading && !error && announcements.length === 0 && (hasFilters ? <EmptyState kind="filtered" title="No announcements match" description="Try a different search or category." onClearFilters={clearFilters} /> : <EmptyState icon={Megaphone} title="No announcements yet" description="Your officers post them here." />)}
    {!loading && !error && announcements.map((item) => <AnnouncementCard key={item.id} announcement={item} showSource={showSource} />)}
    {!loading && !error && <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="announcements" />}
    </div>
  </div>;
}
