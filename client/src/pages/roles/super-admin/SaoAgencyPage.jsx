import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, SkeletonStat, SkeletonTable, Stat, StatusBadge } from '../../../components/ui';
import { RegistrationRowStatus } from '../../../components/organizations/RegistrationFlow';
import { getSystemAgency } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { organizationOverviewPath } from './agencyStatus';

const PENDING_REVIEW_PATH = '/dashboard/super-admin/organizations?status=pending';
const reviewPath = (organizationId) => `${PENDING_REVIEW_PATH}&review=${organizationId}`;
const provisionPath = (organizationId) => `/dashboard/super-admin/admins?organization=${organizationId}&create=1`;
const NO_ORGANIZATIONS = 'No student organizations yet. The Department Head registers them.';

const needsAdministrator = (row) => row.lifecycle_status === 'active' && Number(row.administrators_count ?? 0) === 0;
const actionRank = (row) => {
  if (row.lifecycle_status === 'pending') return 0;
  if (needsAdministrator(row)) return 1;
  return (row.pending_approvals_count ?? 0) + (row.pending_documents_count ?? 0) > 0 ? 2 : 3;
};
const byAction = (left, right) => actionRank(left) - actionRank(right) || String(left.name || '').localeCompare(String(right.name || ''));

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function Count({ value }) {
  return <span className={value ? 'font-bold text-ink' : 'text-ink-muted'}>{value}</span>;
}

function LifecycleBadge({ status }) {
  if (status !== 'archived') return <StatusBadge status={status} />;
  return <span role="img" aria-label="Archived, read only"><StatusBadge status={status} /></span>;
}

function NeedsAttention({ row }) {
  const approvals = row.pending_approvals_count ?? 0;
  const documents = row.pending_documents_count ?? 0;
  if (!approvals && !documents) return <span className="text-xs font-medium text-ink-muted">Nothing waiting</span>;
  const parts = [];
  if (approvals) parts.push(plural(approvals, 'approval', 'approvals'));
  if (documents) parts.push(plural(documents, 'document', 'documents'));
  return <span className="font-bold text-ink">{parts.join(', ')}</span>;
}

const COLUMNS = [
  {
    key: 'name',
    header: 'Organization',
    render: (row) => <span className="block min-w-0"><span className="block break-words font-bold text-ink">{formatDisplayText(row.name)}</span>{row.acronym && <span className="block text-xs font-medium text-ink-muted">{row.acronym}</span>}</span>,
  },
  {
    key: 'lifecycle_status',
    header: 'Status',
    render: (row) => (
      <span className="block min-w-0">
        <LifecycleBadge status={row.lifecycle_status} />
        <RegistrationRowStatus organization={row} viewerRole="SUPER_ADMIN" className="mt-2 max-w-[14rem]" />
      </span>
    ),
  },
  { key: 'members', header: 'Members', align: 'right', render: (row) => <Count value={row.member_counts?.total ?? 0} /> },
  { key: 'needs_attention', header: 'Needs attention', render: (row) => <NeedsAttention row={row} /> },
];

function rowActions(row) {
  const name = formatDisplayText(row.name);
  return (
    <span className="inline-flex items-center gap-2">
      {row.lifecycle_status === 'pending' && <Button to={reviewPath(row.id)} variant="secondary" size="sm" className="max-md:min-h-[42px]" aria-label={`Review ${name}`}>Review</Button>}
      {needsAdministrator(row) && <Button to={provisionPath(row.id)} variant="secondary" size="sm" className="max-md:min-h-[42px]" aria-label={`Provision administrator for ${name}`}>Provision administrator</Button>}
      <Button to={organizationOverviewPath(row.id)} variant="ghost" size="sm" className="max-md:min-h-[42px]" aria-label={`Open ${name}`}>Open</Button>
    </span>
  );
}

function OrganizationsTable({ rows, caption }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={[...rows].sort(byAction)}
      caption={caption}
      actions={rowActions}
      emptyState={<p className="px-5 py-6 text-sm font-medium text-ink-muted">{NO_ORGANIZATIONS}</p>}
    />
  );
}

function collegeLabel(college) {
  return `${formatDisplayText(college.name)}${college.code ? ` (${college.code})` : ''}`;
}

function CollegeSection({ college }) {
  const counts = college.by_lifecycle_status || {};
  const awaitingAdministrator = (college.organizations || []).filter(needsAdministrator).length;
  const needsReview = (counts.pending || 0) + (counts.returned || 0) + awaitingAdministrator > 0;
  const [expanded, setExpanded] = useState(needsReview);

  if (!college.organizations_count) {
    return (
      <section aria-labelledby={`college-${college.id}`} className="flex flex-wrap items-center gap-2 px-1">
        <Building2 size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />
        <h2 id={`college-${college.id}`} className="break-words text-sm font-semibold text-ink-muted">{collegeLabel(college)}</h2>
        <span className="text-sm font-medium text-ink-muted">{NO_ORGANIZATIONS}</span>
      </section>
    );
  }

  return (
    <section aria-labelledby={`college-${college.id}`} className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 id={`college-${college.id}`} className="min-w-0 text-base font-bold text-ink">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`college-${college.id}-organizations`}
            onClick={() => setExpanded((current) => !current)}
            className="flex min-h-11 items-center gap-2 text-left"
          >
            <ChevronDown size={18} className={`shrink-0 text-brand-700 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
            <span className="break-words">{collegeLabel(college)}</span>
          </button>
        </h2>
        <p className="text-xs font-semibold text-ink-muted">
          <Count value={college.organizations_count} /> {college.organizations_count === 1 ? 'organization' : 'organizations'} · <Count value={counts.pending || 0} /> pending · <Count value={counts.active || 0} /> active · <Count value={counts.returned || 0} /> returned · <Count value={counts.archived || 0} /> archived{awaitingAdministrator > 0 && <> · <Count value={awaitingAdministrator} /> awaiting administrator</>}
        </p>
      </header>
      {expanded && (
        <div id={`college-${college.id}-organizations`} className="border-t border-line">
          <OrganizationsTable rows={college.organizations || []} caption={`Organizations of ${college.name}`} />
        </div>
      )}
    </section>
  );
}

function actionCount(college) {
  return (college.by_lifecycle_status?.pending || 0) + (college.organizations || []).filter(needsAdministrator).length;
}

function sortColleges(colleges) {
  return [...colleges].sort((left, right) => {
    const leftCounts = left.by_lifecycle_status || {};
    const rightCounts = right.by_lifecycle_status || {};
    return actionCount(right) - actionCount(left)
      || (rightCounts.returned || 0) - (leftCounts.returned || 0)
      || String(left.name || '').localeCompare(String(right.name || ''));
  });
}

export default function SaoAgencyPage() {
  const [agency, setAgency] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAgency(await getSystemAgency());
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load the agency overview.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
        <SkeletonTable />
      </div>
    );
  }

  if (error || !agency) return <ErrorState title="Agency overview unavailable" description={error} onRetry={load} />;

  const totals = agency.totals || {};
  const byStatus = totals.by_lifecycle_status || {};
  const pending = byStatus.pending || 0;
  const colleges = sortColleges(agency.colleges || []);
  const unassigned = agency.unassigned_organizations || [];

  return (
    <div className="space-y-5">
      <section aria-label="Agency totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pending reviews" value={pending} to={PENDING_REVIEW_PATH} />
        <Stat label="Organizations" value={totals.organizations ?? 0} to="/dashboard/super-admin/organizations?status=active" />
        <Stat label="Colleges" value={totals.colleges ?? colleges.length} to="/dashboard/super-admin/colleges" />
        <Stat label="Archived" value={byStatus.archived || 0} to="/dashboard/super-admin/organizations?status=archived" />
      </section>

      {colleges.map((college) => <CollegeSection key={college.id} college={college} />)}

      {unassigned.length > 0 && (
        <section aria-labelledby="unassigned-organizations" className="overflow-hidden rounded-card border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 id="unassigned-organizations" className="text-base font-bold text-ink">Organizations without a college</h2>
            <p className="mt-1 text-xs font-medium text-ink-muted">These organizations are not assigned to a college yet.</p>
          </header>
          <OrganizationsTable rows={unassigned} caption="Organizations without a college" />
        </section>
      )}

      {!colleges.length && !unassigned.length && <EmptyState icon={Building2} title="No colleges or organizations yet" description="Colleges and the organizations Department Heads register will appear here." />}
    </div>
  );
}
