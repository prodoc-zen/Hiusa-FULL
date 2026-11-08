import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import FeedPost from '../../../components/feed/FeedPost';
import { getStudentFeed } from '../../../services/studentFeedService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { RoleBriefing } from '../../../components/dashboard';
import { ProcessTracker } from '../../../components/process';
import { Button, EmptyState, ErrorState, Skeleton } from '../../../components/ui';
import { peso } from '../../../lib/format';

function formatEventDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function FeedSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5" role="status">
      <Skeleton className="h-4 w-44" />
      <Skeleton className="mt-2 h-3 w-28" />
      <Skeleton className="mt-5 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <span className="sr-only">Loading post</span>
    </div>
  );
}

function clearanceLine(clearance) {
  switch (clearance?.status) {
    case 'in_progress': {
      const pending = Number(clearance.pending_count) || 0;
      return `Clearance: ${pending} ${pending === 1 ? 'signature' : 'signatures'} pending`;
    }
    case 'cleared': return 'Clearance: Cleared';
    case 'held': return 'On hold: see My clearance';
    case 'none': return 'No clearance period';
    default: return null;
  }
}

function owedLine(owedTotal) {
  if (owedTotal == null) return null;
  const amount = Number(owedTotal);
  if (!Number.isFinite(amount)) return null;
  return amount > 0 ? `You owe ${peso(amount)}` : 'Nothing owed';
}

export default function StudentHomePage() {
  const [account, setAccount] = useState(null);
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
  const handleBriefing = useCallback((data) => setAccount(data?.account ?? null), []);
  const owedText = owedLine(account?.owed_total);
  const clearanceText = clearanceLine(account?.clearance);
  const activeElection = sidebar.active_election;
  const upcomingEvents = Array.isArray(sidebar.upcoming_events) ? sidebar.upcoming_events : [];

  return (
    <div className="w-full space-y-6 overflow-x-hidden">
      <ProcessTracker />
      <RoleBriefing onData={handleBriefing} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,720px)_360px] xl:justify-center">
        <section className="min-w-0 space-y-4" aria-label="Organization feed">
          <h2 className="text-base font-semibold text-ink">Organization feed</h2>
          {initialLoading && [1, 2, 3].map((item) => <FeedSkeleton key={item} />)}
          {!initialLoading && items.map((item) => <FeedPost key={item.key} item={item} organization={organization} />)}

          {!initialLoading && items.length === 0 && !error && (
            <EmptyState
              title="No announcements yet"
              description="Posts from your organization and the university show here."
              action={<Button to="/dashboard/events/activity-calendar" variant="secondary">Find an event to join</Button>}
            />
          )}
          {error && <ErrorState title="Could not load your feed" description={error} onRetry={retry} />}
          {loadingMore && <FeedSkeleton />}
          <div ref={sentinelRef} className="h-1" aria-hidden="true" />
        </section>

        <aside className="order-first min-w-0 space-y-4 xl:order-none xl:sticky xl:top-5" aria-label="Student shortcuts">
          {activeElection && (
            <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="student-election-title">
              <h2 id="student-election-title" className="text-sm font-semibold text-ink">Voting is open</h2>
              <p className="mt-1 text-sm font-medium text-ink">{formatDisplayText(activeElection.title)}</p>
              <p className="mt-1 text-xs text-ink-muted-strong">{activeElection.has_voted ? 'Your ballot has been submitted.' : 'Review the candidates and cast your ballot before voting closes.'}</p>
              {activeElection.has_voted
                ? <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-success-strong"><ShieldCheck size={16} aria-hidden="true" /> Vote submitted</p>
                : <Button to={`/elections/${activeElection.id}/vote`} variant="secondary" className="mt-3 w-full">Vote now</Button>}
            </section>
          )}

          <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="student-events-title">
            <h2 id="student-events-title" className="text-sm font-semibold text-ink">Coming up</h2>
            <div className="mt-3 divide-y divide-line-soft">
              {upcomingEvents.length ? upcomingEvents.map((event) => (
                <div key={event.id} className="flex gap-3 py-3 first:pt-0">
                  <span className="w-14 shrink-0 text-xs font-medium text-ink-muted-strong">{formatEventDate(event.start_time)}</span>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium text-ink">{formatDisplayText(event.title)}</p>
                    {event.location && <p className="mt-0.5 truncate text-xs text-ink-muted">{event.location}</p>}
                  </div>
                </div>
              )) : <p className="py-2 text-sm text-ink-muted">No upcoming events yet.</p>}
            </div>
            <Link to="/dashboard/events/activity-calendar" className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Open activity calendar <ChevronRight size={14} aria-hidden="true" /></Link>
          </section>

          <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="student-account-title">
            <h2 id="student-account-title" className="text-sm font-semibold text-ink">Your account</h2>
            <div className="mt-2 divide-y divide-line-soft">
              <Link to="/dashboard/finance/statement-of-account" className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-subtle"><span className="min-w-0"><span className="block text-sm font-medium text-ink">Statement of account</span><span className="block text-xs text-ink-muted">{owedText ?? 'See what you owe and your receipts'}</span></span><ChevronRight size={14} className="shrink-0 text-ink-soft" aria-hidden="true" /></Link>
              <Link to="/dashboard/my-clearance" className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-subtle"><span className="min-w-0"><span className="block text-sm font-medium text-ink">My clearance</span><span className="block text-xs text-ink-muted">{clearanceText ?? 'See which offices have signed'}</span></span><ChevronRight size={14} className="shrink-0 text-ink-soft" aria-hidden="true" /></Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
