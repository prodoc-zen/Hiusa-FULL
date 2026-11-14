import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import OrgAccessPanel from '../../../components/org/OrgAccessPanel';
import { RegistrationNextStep } from '../../../components/organizations/RegistrationFlow';
import OrgTransactions from '../../../components/org/OrgTransactions';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, PageHeader, Select, SkeletonTable, Stat, StatusBadge, Tabs } from '../../../components/ui';
import useActiveSubAccount from '../../../hooks/useActiveSubAccount';
import { manilaDate, peso } from '../../../lib/format';
import notify from '../../../lib/notify';
import { getOrganizationSpace } from '../../../services/orgSpaceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { ROLE_LABELS } from '../../../utils/displayText.js';
import { openProtectedFile } from '../../../utils/openProtectedFile';

const COLLEGES_PATH = '/dashboard/super-admin/colleges';
const COLLEGE_ORGANIZATIONS_PATH = '/dashboard/department-head/organizations';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People and access' },
  { key: 'events', label: 'Events' },
  { key: 'finance', label: 'Finance' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'documents', label: 'Documents' },
];

function Loading() {
  return (
    <div className="mt-6" role="status" aria-label="Loading organization">
      <SkeletonTable columns={4} rows={5} />
    </div>
  );
}

function OverviewTab({ space, oversight }) {
  const { counts, lifecycle, events, finance } = space;
  const next = events.upcoming[0];
  const needsHead = lifecycle.status === 'active' && counts.administrators === 0;

  return (
    <div className="space-y-4">
      {needsHead && <RegistrationNextStep organization={{ ...space.organization, lifecycle_status: 'active', administrators_count: 0 }} viewerRole={oversight ? 'SUPER_ADMIN' : 'DEPARTMENT_HEAD'} />}
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-3">
        <Stat label="Members" value={counts.members} to="?tab=people" />
        <Stat label="Upcoming events" value={counts.upcoming_events} to="?tab=events" />
        <Stat label="Documents to review" value={counts.pending_documents} to="?tab=documents" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Standing">
          <div className="flex flex-wrap items-center gap-3">
            {lifecycle.status === 'active'
              ? <span className="text-sm text-ink">Registered and active</span>
              : <StatusBadge status={lifecycle.status} />}
            {lifecycle.reviewed_at && <span className="text-sm text-ink-muted">Reviewed {manilaDate(lifecycle.reviewed_at)}</span>}
          </div>
          {lifecycle.review_remarks && <p className="mt-3 text-sm text-ink">{lifecycle.review_remarks}</p>}
          {oversight && <Button variant="secondary" size="sm" className="mt-3" to={`/dashboard/super-admin/organizations/${space.organization.id}`}>Registration details</Button>}
        </Card>
        <Card title="Next event">
          {next ? (
            <div>
              <p className="text-sm font-semibold text-ink">{next.title}</p>
              <p className="mt-1 text-sm font-medium text-ink-muted">{manilaDate(next.start_time, 'long')}{next.location ? ` · ${next.location}` : ''}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No upcoming events.</p>
          )}
        </Card>
        <Card title="Money">
          {finance.approved_budget_count > 0 ? (
            <p className="text-sm text-ink"><span className="text-2xl font-semibold tabular-nums">{peso(finance.remaining)}</span> left across {finance.approved_budget_count} approved {finance.approved_budget_count === 1 ? 'budget' : 'budgets'}</p>
          ) : (
            <p className="text-sm text-ink-muted">No approved budget yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function MembersTab({ space }) {
  const columns = [
    { key: 'name', header: 'Name', render: (member) => <span className="block min-w-0"><span className="block break-words font-semibold">{member.name}</span><span className="block text-xs font-medium text-ink-muted">{member.email}</span></span> },
    { key: 'position_title', header: 'Position', render: (member) => member.position_title || 'Member' },
    { key: 'role', header: 'Access', render: (member) => ROLE_LABELS[member.role] || member.role },
    { key: 'school_id', header: 'ID', render: (member) => <span className="text-xs font-medium text-ink-muted">{member.school_id}</span> },
  ];

  return (
    <Card title="People" description="Active members only. Its own Admin gives and removes access.">
      <DataTable
        columns={columns}
        rows={space.members}
        rowKey={(member) => member.profile_id}
        caption="Organization members"
        emptyState={<EmptyState title="No members yet" description="People appear here once they join the organization." />}
      />
    </Card>
  );
}

function EventList({ title, events, empty }) {
  return (
    <Card title={title}>
      {events.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{event.title}</p>
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
    { key: 'title', header: 'Budget', render: (budget) => <span className="font-semibold">{budget.title}</span> },
    { key: 'allocated', header: 'Allocated', align: 'right', render: (budget) => peso(budget.allocated) },
    { key: 'spent', header: 'Spent', align: 'right', render: (budget) => peso(budget.spent) },
    { key: 'remaining', header: 'Left', align: 'right', render: (budget) => peso(budget.remaining) },
  ];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 border-y border-line py-3 lg:grid-cols-4">
        {[['Allocated', finance.allocated], ['Income', finance.income], ['Spent', finance.spent], ['Left', finance.remaining]].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-ink-muted">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{peso(value)}</dd>
          </div>
        ))}
      </dl>
      <Card title="Approved budgets">
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
    { key: 'requirement_name', header: 'Requirement', render: (document) => <span className="font-semibold">{document.requirement_name || 'Document'}</span> },
    { key: 'status', header: 'Status', render: (document) => <StatusBadge status={document.status} /> },
    { key: 'submitted_at', header: 'Sent', render: (document) => (document.submitted_at ? manilaDate(document.submitted_at) : 'Not sent') },
  ];

  return (
    <Card
      title="Documents"
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

export default function OrgSpacePage({ oversight = false }) {
  const { orgId } = useParams();
  const [params, setParams] = useSearchParams();
  const { subAccount, enter } = useActiveSubAccount();
  const [space, setSpace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refused, setRefused] = useState(false);

  const tab = TABS.some((entry) => entry.key === params.get('tab')) ? params.get('tab') : 'overview';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setRefused(false);
    try {
      const response = await getOrganizationSpace(orgId);
      setSpace(response.data);
    } catch (loadError) {
      setSpace(null);
      setRefused(loadError?.response?.status === 403);
      setError(loadError?.response?.status === 403
        ? (oversight ? 'This is not a student organization.' : 'This organization is not in your college.')
        : getApiErrorMessage(loadError, 'Could not load this organization. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [orgId, oversight]);

  useEffect(() => { load(); }, [load]);

  const organizationId = space?.organization?.id;
  useEffect(() => {
    if (!oversight && organizationId && Number(subAccount?.id) !== Number(organizationId)) enter(space.organization);
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
      description={oversight && space ? space.organization.college : undefined}
      actions={oversight ? <Button variant="secondary" to={COLLEGES_PATH}>Back to colleges</Button> : undefined}
    />
  );

  if (loading) {
    return <div>{header}<Loading /></div>;
  }

  if (error || !space) {
    return (
      <div>
        {header}
        <ErrorState title="Could not open this organization" description={error} onRetry={refused ? undefined : load} />
        {refused && !oversight && <Button variant="secondary" to={COLLEGE_ORGANIZATIONS_PATH}>Back to organizations</Button>}
      </div>
    );
  }

  return (
    <div>
      {header}
      <Tabs tabs={TABS.map((entry) => ({ ...entry, panelId: 'org-space-panel' }))} value={tab} onChange={openTab} className="mt-4 hidden sm:block" />
      <div className="mt-4 sm:hidden">
        <Field label="Section">
          <Select value={tab} onChange={(event) => openTab(event.target.value)}>
            {TABS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </Select>
        </Field>
      </div>
      <div id="org-space-panel" role="tabpanel" className="mt-6">
        {tab === 'overview' && <OverviewTab space={space} oversight={oversight} />}
        {tab === 'people' && (oversight
          ? <MembersTab space={space} />
          : <OrgAccessPanel organizationId={space.organization.id} actorRole="DEPARTMENT_HEAD" />)}
        {tab === 'events' && <EventsTab space={space} />}
        {tab === 'finance' && <FinanceTab space={space} />}
        {tab === 'transactions' && <OrgTransactions organizationId={space.organization.id} />}
        {tab === 'documents' && <DocumentsTab space={space} />}
      </div>
    </div>
  );
}
