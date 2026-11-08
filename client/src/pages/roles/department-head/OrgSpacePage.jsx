import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import OrgAccessPanel from '../../../components/org/OrgAccessPanel';
import { Button, Card, DataTable, EmptyState, ErrorState, PageHeader, SkeletonCard, SkeletonStat, Stat, StatusBadge, Tabs } from '../../../components/ui';
import useActiveSubAccount from '../../../hooks/useActiveSubAccount';
import { manilaDate, peso } from '../../../lib/format';
import notify from '../../../lib/notify';
import { getOrganizationSpace } from '../../../services/orgSpaceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People and access' },
  { key: 'events', label: 'Events' },
  { key: 'finance', label: 'Finance' },
  { key: 'documents', label: 'Documents' },
];

function Loading() {
  return (
    <div className="mt-6 space-y-4" role="status" aria-label="Loading organization">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat />
      </div>
      <SkeletonCard />
    </div>
  );
}

function OverviewTab({ space, onOpen }) {
  const { counts, lifecycle, events, finance } = space;
  const next = events.upcoming[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <Stat label="Members" value={counts.members} />
        <Stat label="Officers" value={counts.officers} />
        <Stat label="Upcoming events" value={counts.upcoming_events} />
        <Stat label="Documents to review" value={counts.pending_documents} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Standing">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={lifecycle.status} />
            {lifecycle.reviewed_at && <span className="text-sm font-medium text-ink-muted">Reviewed {manilaDate(lifecycle.reviewed_at)}</span>}
          </div>
          {lifecycle.review_remarks && <p className="mt-3 text-sm font-medium text-ink">{lifecycle.review_remarks}</p>}
        </Card>
        <Card title="Next event" actions={<Button variant="secondary" size="sm" onClick={() => onOpen('events')}>All events</Button>}>
          {next ? (
            <div>
              <p className="text-sm font-bold text-ink">{next.title}</p>
              <p className="mt-1 text-sm font-medium text-ink-muted">{manilaDate(next.start_time, 'long')}{next.location ? ` · ${next.location}` : ''}</p>
            </div>
          ) : (
            <p className="text-sm font-medium text-ink-muted">No upcoming events.</p>
          )}
        </Card>
        <Card title="Money" actions={<Button variant="secondary" size="sm" onClick={() => onOpen('finance')}>See finance</Button>}>
          {finance.approved_budget_count > 0 ? (
            <p className="text-sm font-medium text-ink"><span className="text-2xl font-extrabold tabular-nums">{peso(finance.remaining)}</span> left across {finance.approved_budget_count} approved {finance.approved_budget_count === 1 ? 'budget' : 'budgets'}</p>
          ) : (
            <p className="text-sm font-medium text-ink-muted">No approved budget yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function EventList({ title, events, empty }) {
  return (
    <Card title={title}>
      {events.length === 0 ? (
        <p className="text-sm font-medium text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">{event.title}</p>
                <p className="text-xs font-medium text-ink-muted">{manilaDate(event.start_time, 'long')}{event.location ? ` · ${event.location}` : ''}</p>
              </div>
              <StatusBadge status={event.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventsTab({ space }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <EventList title="Upcoming" events={space.events.upcoming} empty="No upcoming events." />
      <EventList title="Recent" events={space.events.recent} empty="No past events yet." />
    </div>
  );
}

function FinanceTab({ space }) {
  const { finance } = space;
  const columns = [
    { key: 'title', header: 'Budget', render: (budget) => <span className="font-bold">{budget.title}</span> },
    { key: 'allocated', header: 'Allocated', align: 'right', render: (budget) => peso(budget.allocated) },
    { key: 'spent', header: 'Spent', align: 'right', render: (budget) => peso(budget.spent) },
    { key: 'remaining', header: 'Left', align: 'right', render: (budget) => peso(budget.remaining) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <Stat label="Allocated" value={peso(finance.allocated)} />
        <Stat label="Income" value={peso(finance.income)} />
        <Stat label="Spent" value={peso(finance.spent)} />
        <Stat label="Left" value={peso(finance.remaining)} />
      </div>
      <Card title="Approved budgets" description="Only budgets the SAO approved count here.">
        <DataTable
          columns={columns}
          rows={finance.budgets}
          caption="Approved budgets"
          emptyState={<EmptyState title="No approved budget yet" description="Budgets show up here after the SAO approves them." />}
        />
      </Card>
    </div>
  );
}

function DocumentsTab({ space }) {
  const [openingId, setOpeningId] = useState(null);

  async function open(document) {
    setOpeningId(document.id);
    try {
      await openProtectedFile(document.open_url);
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Could not open this file. Try again.'));
    } finally {
      setOpeningId(null);
    }
  }

  const columns = [
    { key: 'requirement_name', header: 'Requirement', render: (document) => <span className="font-bold">{document.requirement_name || 'Document'}</span> },
    { key: 'status', header: 'Status', render: (document) => <StatusBadge status={document.status} /> },
    { key: 'submitted_at', header: 'Sent', render: (document) => (document.submitted_at ? manilaDate(document.submitted_at) : 'Not sent') },
  ];

  return (
    <Card
      title="Documents"
      description="Requirements this organization sent in."
      actions={<Button variant="secondary" size="sm" to="/dashboard/records">Open records</Button>}
    >
      <DataTable
        columns={columns}
        rows={space.documents}
        caption="Submitted documents"
        actionsHeader="File"
        actions={(document) => (document.open_url
          ? <Button variant="secondary" size="sm" loading={openingId === document.id} onClick={() => open(document)} aria-label={`Open ${document.requirement_name || 'document'}`}>Open</Button>
          : null)}
        emptyState={<EmptyState title="No documents yet" description="Files appear here after the organization submits them." />}
      />
    </Card>
  );
}

export default function OrgSpacePage() {
  const { orgId } = useParams();
  const [params, setParams] = useSearchParams();
  const { subAccount, enter } = useActiveSubAccount();
  const [space, setSpace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const tab = TABS.some((entry) => entry.key === params.get('tab')) ? params.get('tab') : 'overview';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getOrganizationSpace(orgId);
      setSpace(response.data);
    } catch (loadError) {
      setSpace(null);
      setError(loadError?.response?.status === 403
        ? 'This organization is not in your college.'
        : getApiErrorMessage(loadError, 'Could not load this organization. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const organizationId = space?.organization?.id;
  useEffect(() => {
    if (organizationId && Number(subAccount?.id) !== Number(organizationId)) enter(space.organization);
    // Only a change of organization opens a space; a later switch back to the college must stay switched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  function openTab(key) {
    const next = new URLSearchParams(params);
    if (key === 'overview') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  }

  const header = (
    <PageHeader
      title={space?.organization?.name || 'Organization'}
      description={space ? `${space.organization.acronym ? `${space.organization.acronym} · ` : ''}${space.organization.college}` : undefined}
    />
  );

  if (loading) {
    return <div>{header}<Loading /></div>;
  }

  if (error || !space) {
    return <div>{header}<ErrorState title="Could not open this organization" description={error} onRetry={load} /></div>;
  }

  return (
    <div>
      {header}
      <Tabs tabs={TABS.map((entry) => ({ ...entry, panelId: 'org-space-panel' }))} value={tab} onChange={openTab} className="mt-4" />
      <div id="org-space-panel" role="tabpanel" className="mt-6">
        {tab === 'overview' && <OverviewTab space={space} onOpen={openTab} />}
        {tab === 'people' && <OrgAccessPanel organizationId={space.organization.id} actorRole="DEPARTMENT_HEAD" />}
        {tab === 'events' && <EventsTab space={space} />}
        {tab === 'finance' && <FinanceTab space={space} />}
        {tab === 'documents' && <DocumentsTab space={space} />}
      </div>
    </div>
  );
}
