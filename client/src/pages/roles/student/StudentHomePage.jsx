import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, Inbox, RefreshCw, ShieldCheck, Vote } from 'lucide-react';
import { Link } from 'react-router-dom';
import FeedPost from '../../../components/feed/FeedPost';
import { getStudentFeed } from '../../../services/studentFeedService';
import { getApiErrorMessage } from '../../../utils/apiError';

function formatEventDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function FeedSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white" role="status">
      <div className="flex gap-3 p-4 sm:p-5"><div className="h-11 w-11 animate-pulse rounded-full bg-slate-100" /><div className="flex-1 space-y-2"><div className="h-4 w-44 animate-pulse rounded bg-slate-100" /><div className="h-3 w-28 animate-pulse rounded bg-slate-100" /></div></div>
      <div className="space-y-3 px-4 pb-4 sm:px-5"><div className="h-5 w-3/4 animate-pulse rounded bg-slate-100" /><div className="h-3 w-full animate-pulse rounded bg-slate-100" /><div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" /></div>
      <div className="h-56 animate-pulse bg-slate-100" /><span className="sr-only">Loading post</span>
    </div>
  );
}

export default function StudentHomePage() {
  const [items, setItems] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [sidebar, setSidebar] = useState({ active_election: null, upcoming_events: [] });
  const [nextPage, setNextPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const sentinelRef = useRef(null);
  const requestedPages = useRef(new Set());
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (page, replace = false) => {
    if (loadingRef.current || requestedPages.current.has(page)) return;
    loadingRef.current = true;
    requestedPages.current.add(page);
    if (page === 1) setInitialLoading(true); else setLoadingMore(true);
    setError('');

    try {
      const response = await getStudentFeed(page, 12);
      const incoming = Array.isArray(response.items) ? response.items : [];
      setItems((current) => {
        const merged = replace ? incoming : [...current, ...incoming];
        return [...new Map(merged.map((item) => [item.key, item])).values()];
      });
      if (response.organization) setOrganization(response.organization);
      if (response.sidebar) setSidebar(response.sidebar);
      setHasMore(Boolean(response.pagination?.has_more));
      setNextPage(response.pagination?.next_page || page + 1);
    } catch (requestError) {
      requestedPages.current.delete(page);
      setError(getApiErrorMessage(requestError, 'Unable to load your organization feed.'));
    } finally {
      loadingRef.current = false;
      setInitialLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { loadPage(1, true); }, [loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || initialLoading || error) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingRef.current) loadPage(nextPage);
    }, { rootMargin: '320px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, initialLoading, loadPage, nextPage]);

  const retry = () => {
    const page = items.length ? nextPage : 1;
    requestedPages.current.delete(page);
    loadPage(page, items.length === 0);
  };
  const activeElection = sidebar.active_election;
  const upcomingEvents = Array.isArray(sidebar.upcoming_events) ? sidebar.upcoming_events : [];

  return (
    <div className="mx-auto w-full max-w-6xl overflow-x-hidden">
      <header className="mb-4 rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Student community</p>
        <h1 className="mt-1 truncate text-xl font-black text-[#0F172A] sm:text-2xl">{organization?.name || 'HIUSA Feed'}</h1>
        <p className="mt-1 text-xs font-medium text-[#64748B] sm:text-sm">Official updates, events, and elections from your organization.</p>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,720px)_300px] xl:justify-center">
        <section className="min-w-0 space-y-4" aria-label="Organization feed">
          {initialLoading && [1, 2, 3].map((item) => <FeedSkeleton key={item} />)}
          {!initialLoading && items.map((item) => <FeedPost key={item.key} item={item} organization={organization} />)}

          {!initialLoading && items.length === 0 && !error && (
            <div className="rounded-lg border border-dashed border-[#B9CBD8] bg-white px-5 py-14 text-center">
              <Inbox size={34} className="mx-auto text-[#94A3B8]" /><h2 className="mt-3 text-base font-black text-[#0F172A]">Your feed is quiet</h2><p className="mt-1 text-sm text-[#64748B]">Official organization updates will appear here when published.</p>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-white p-5 text-center"><p className="text-sm font-semibold text-red-700">{error}</p><button type="button" onClick={retry} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0F172A] hover:bg-[#F8FBFD]"><RefreshCw size={15} /> Try again</button></div>
          )}
          {loadingMore && <FeedSkeleton />}
          <div ref={sentinelRef} className="h-1" aria-hidden="true" />
          {!initialLoading && items.length > 0 && !hasMore && <p className="py-4 text-center text-xs font-semibold text-[#94A3B8]">You’re all caught up.</p>}
        </section>

        <aside className="order-first min-w-0 space-y-4 xl:order-none xl:sticky xl:top-5" aria-label="Student shortcuts">
          {activeElection && (
            <section className="rounded-lg border border-[#0B8ED0]/25 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#0B8ED0]"><Vote size={14} /> Active election</span><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /></div>
              <h2 className="mt-3 text-base font-black leading-6 text-[#0F172A]">{activeElection.title}</h2>
              <p className="mt-1 text-xs leading-5 text-[#64748B]">{activeElection.has_voted ? 'Your ballot has been securely submitted.' : 'Review the candidates and cast your ballot before voting closes.'}</p>
              {activeElection.has_voted ? <span className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 text-xs font-bold text-emerald-700"><ShieldCheck size={15} /> Vote submitted</span> : <Link to={`/elections/${activeElection.id}/vote`} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] text-sm font-bold text-white hover:bg-[#0878B7]"><ShieldCheck size={16} /> Enter secure voting</Link>}
            </section>
          )}

          <section className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-black text-[#0F172A]">Coming up</h2><CalendarDays size={17} className="text-[#0B8ED0]" /></div>
            <div className="mt-3 divide-y divide-[#E5EDF3]">
              {upcomingEvents.length ? upcomingEvents.map((event) => <div key={event.id} className="flex gap-3 py-3 first:pt-1"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] px-1 text-center text-[9px] font-black uppercase text-[#0B8ED0]">{formatEventDate(event.start_time)}</span><div className="min-w-0"><p className="line-clamp-2 text-xs font-bold leading-5 text-[#0F172A]">{event.title}</p>{event.location && <p className="mt-0.5 truncate text-[11px] text-[#64748B]">{event.location}</p>}</div></div>) : <p className="py-4 text-xs text-[#64748B]">No upcoming events yet.</p>}
            </div>
            <Link to="/dashboard/events/activity-calendar" className="mt-2 inline-flex h-10 w-full items-center justify-center gap-1 text-xs font-bold text-[#0B8ED0] hover:underline">Open activity calendar <ChevronRight size={14} /></Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
