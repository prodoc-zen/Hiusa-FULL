import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Building2, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, DataTable, EmptyState, ErrorState, SkeletonStat, SkeletonTable, Stat, StatusBadge } from '../../../components/ui';
import { getSystemAgency } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { accreditationBadge, organizationOverviewPath } from './agencyStatus';

const PENDING_REVIEW_PATH = '/dashboard/super-admin/organizations?status=pending';

const COLUMNS = [
  {
    key: 'name',
    header: 'Organization',
    render: (row) => <span className="block min-w-0"><span className="block break-words font-bold text-ink">{formatDisplayText(row.name)}</span>{row.acronym && <span className="block text-xs font-medium text-ink-muted">{row.acronym}</span>}</span>,
  },
  { key: 'lifecycle_status', header: 'Status', render: (row) => <StatusBadge status={row.lifecycle_status} /> },
  { key: 'members', header: 'Members', align: 'right', render: (row) => row.member_counts?.total ?? 0 },
  { key: 'administrators_count', header: 'Admins', align: 'right', render: (row) => row.administrators_count ?? 0 },
  { key: 'accreditation_status', header: 'Accreditation', render: (row) => { const badge = accreditationBadge(row.accreditation_status); return <StatusBadge label={badge.label} tone={badge.tone} />; } },
  { key: 'pending_approvals_count', header: 'Pending approvals', align: 'right', render: (row) => row.pending_approvals_count ?? 0 },
  { key: 'pending_documents_count', header: 'Pending documents', align: 'right', render: (row) => row.pending_documents_count ?? 0 },
];

function rowActions(row) {
  const name = formatDisplayText(row.name);
  return (
    <>
      {row.lifecycle_status === 'pending' && <Button to={PENDING_REVIEW_PATH} variant="secondary" size="sm" aria-label={`Review ${name}`}>Review</Button>}
      <Button to={organizationOverviewPath(row.id)} variant="ghost" size="sm" aria-label={`Open ${name}`}>Open</Button>
    </>
  );
}

function OrganizationsTable({ rows, caption }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      caption={caption}
      actions={rowActions}
      emptyState={<p className="px-5 py-6 text-sm font-medium text-ink-muted">No student organizations yet.</p>}
    />
  );
}

function CollegeSection({ college }) {
  const counts = college.by_lifecycle_status || {};
  return (
    <section aria-labelledby={`college-${college.id}`} className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Building2 size={18} className="shrink-0 text-brand-700" aria-hidden="true" />
          <h2 id={`college-${college.id}`} className="break-words text-base font-bold text-ink">{formatDisplayText(college.name)}{college.code ? ` (${college.code})` : ''}</h2>
        </div>
        <p className="text-xs font-semibold text-ink-muted">{college.organizations_count} {college.organizations_count === 1 ? 'organization' : 'organizations'} · {counts.pending || 0} pending · {counts.active || 0} active · {counts.returned || 0} returned · {counts.archived || 0} archived</p>
      </header>
      <OrganizationsTable rows={college.organizations || []} caption={`Organizations of ${college.name}`} />
    </section>
  );
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
  const colleges = agency.colleges || [];
  const unassigned = agency.unassigned_organizations || [];

  return (
    <div className="space-y-5">
      <section aria-label="Agency totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Colleges" value={totals.colleges ?? colleges.length} to="/dashboard/super-admin/colleges" />
        <Stat label="Organizations" value={totals.organizations ?? 0} to="/dashboard/super-admin/organizations?status=active" />
        <Stat label="Pending reviews" value={pending} to={PENDING_REVIEW_PATH} />
        <Stat label="Archived" value={byStatus.archived || 0} to="/dashboard/super-admin/organizations?status=archived" />
      </section>

      {pending > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-warning-tint p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-ink"><ClipboardCheck size={18} className="shrink-0 text-warning-strong" aria-hidden="true" />{pending} {pending === 1 ? 'organization is' : 'organizations are'} waiting for your review.</p>
          <Link to={PENDING_REVIEW_PATH} className="inline-flex h-11 items-center rounded-control px-3 text-sm font-bold text-brand-700 underline">Review pending organizations</Link>
        </div>
      )}

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
