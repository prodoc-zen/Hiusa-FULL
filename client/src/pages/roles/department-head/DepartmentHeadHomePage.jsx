import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getElections } from '../../../services/electionService';
import { getEvents } from '../../../services/eventService';
import { getAnnouncements } from '../../../services/announcementService';
import { getApprovalRequests } from '../../../services/approvalService';
import { getCollegeOrganizations } from '../../../services/collegeOrganizationService';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import { ProcessTracker } from '../../../components/process';
import { Button, Card, EmptyState, ErrorState, Skeleton, SkeletonStat, Stat } from '../../../components/ui';
import { headCollegeName, storedUser } from '../../../utils/collegeIdentity';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import useActiveSubAccount from '../../../hooks/useActiveSubAccount';

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ORGANIZATIONS_PATH = '/dashboard/department-head/organizations';

function ListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2 p-5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
    </div>
  );
}

function ViewAll({ to }) {
  return <NavLink to={to} className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 hover:underline">View all</NavLink>;
}

export default function DepartmentHeadHomePage() {
  const [data, setData] = useState({ elections: [], events: [], announcements: [], organizations: [] });
  const [pendingApprovalsTotal, setPendingApprovalsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Bumped by every full load, a reload and an unmount, so a response that belongs to an
  // older request (silent or not) is dropped instead of overwriting newer data.
  const loadEpoch = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      loadEpoch.current += 1;
      setLoading(true);
      setLoadError('');
    }
    const epoch = loadEpoch.current;
    try {
      // /events has no status filter, so the full org event list is walked via
      // fetchAllPages - the endpoint also orders oldest-first, so a single
      // page-1 fetch would surface stale events instead of upcoming ones. The
      // pending-approval queue is only counted, so its `total` backs the tile.
      const [electionsRes, events, announcementsRes, approvalsRes, organizations] = await Promise.all([
        getElections(),
        fetchAllPages((p) => getEvents(p).then((r) => r.data)),
        getAnnouncements({ published_only: 1 }),
        getApprovalRequests({ status: 'pending', per_page: 100 }),
        fetchAllPages((p) => getCollegeOrganizations(p).then((r) => r.data)),
      ]);

      if (epoch !== loadEpoch.current) return;

      const next = {
        elections: Array.isArray(electionsRes) ? electionsRes : (Array.isArray(electionsRes?.data) ? electionsRes.data : []),
        events,
        announcements: unwrapList(announcementsRes?.data),
        organizations,
      };
      setData((current) => (silent && JSON.stringify(current) === JSON.stringify(next) ? current : next));
      setPendingApprovalsTotal(listMeta(approvalsRes?.data).total);
      setLoadError('');
    } catch {
      if (!silent && epoch === loadEpoch.current) setLoadError('Check your connection and try again.');
    } finally {
      if (!silent && epoch === loadEpoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { loadEpoch.current += 1; };
  }, [load, reloadKey]);
  useRefetchOnReturn(() => load({ silent: true }));

  const activeElection = data.elections.find((e) => e.status === 'active') || null;
  const upcomingEvents = data.events
    .filter((e) => e.status === 'upcoming' || e.status === 'approved')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const recentAnnouncements = data.announcements.filter((a) => a.is_published).sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)).slice(0, 3);

  const college = headCollegeName(storedUser());
  const { subAccountId } = useActiveSubAccount();
  const activeSubId = subAccountId ? String(subAccountId) : null;
  const scopedOrganizations = activeSubId ? data.organizations.filter((o) => String(o.id) === activeSubId) : data.organizations;
  const organizationCount = (status) => scopedOrganizations.filter((o) => o.lifecycle_status === status).length;

  // Returned and pending registrations only exist on older filings, so they ride along as context
  // on the Active tile instead of taking tiles of their own.
  const needAttention = [
    organizationCount('returned') > 0 && `${organizationCount('returned')} returned`,
    organizationCount('pending') > 0 && `${organizationCount('pending')} pending review`,
  ].filter(Boolean).join(', ');
  const noOrganizations = !loading && !loadError && data.organizations.length === 0;

  return (
    <div className="w-full space-y-6">
      <ProcessTracker />
      {loadError && <ErrorState title="Could not load your college overview" description={loadError} onRetry={() => setReloadKey((value) => value + 1)} />}

      <section aria-labelledby="college-overview">
        <h2 id="college-overview" className="sr-only">{college ? `${college} organizations` : 'College organizations'}</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((key) => <SkeletonStat key={key} />)}</div>
        ) : noOrganizations ? (
          <Card>
            <EmptyState
              title="No student organizations yet"
              description="Allow a student to apply. Their application comes to you for review."
              action={<Button variant="secondary" to="/dashboard/department-head/people">Allow a student to apply</Button>}
            />
          </Card>
        ) : !loadError && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Awaiting your approval" value={pendingApprovalsTotal} to="/dashboard/department-head/approvals" />
            <Stat label="Active organizations" value={organizationCount('active')} context={needAttention || undefined} to={`${ORGANIZATIONS_PATH}?status=active`} />
            <Stat label="Upcoming events" value={upcomingEvents.length} to="/dashboard/events" />
          </div>
        )}
      </section>

      {activeElection && (
        <Card
          title="Active election"
          actions={<Button variant="secondary" to="/dashboard/elections/election-results">View results</Button>}
        >
          <p className="text-sm font-semibold text-ink">{formatDisplayText(activeElection.title)}</p>
          <p className="mt-1 text-sm text-ink-muted">{formatDate(activeElection.start_time)} to {formatDate(activeElection.end_time)}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Upcoming events" actions={<ViewAll to="/dashboard/events" />} bodyClassName="p-0" className="min-w-0">
          {loading ? (
            <ListSkeleton />
          ) : upcomingEvents.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">No upcoming events.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcomingEvents.slice(0, 4).map((ev) => (
                <li key={ev.id} className="px-5 py-3">
                  <p className="truncate text-sm font-semibold text-ink">{formatDisplayText(ev.title)}</p>
                  <p className="text-xs text-ink-muted">{formatDate(ev.start_time)}{ev.location ? `, ${ev.location}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Announcements" actions={<ViewAll to="/dashboard/announcements/view-announcements" />} bodyClassName="p-0" className="min-w-0">
          {loading ? (
            <ListSkeleton />
          ) : recentAnnouncements.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">No announcements yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recentAnnouncements.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <p className="truncate text-sm font-semibold text-ink">{formatDisplayText(a.title)}</p>
                  <p className="line-clamp-2 text-xs text-ink-muted">{a.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
