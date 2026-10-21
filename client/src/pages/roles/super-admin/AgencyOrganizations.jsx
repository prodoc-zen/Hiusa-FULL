import { formatDisplayText } from '../../../utils/displayText.js';
import { Button, DataTable, StatusBadge } from '../../../components/ui';
import { RegistrationRowStatus } from '../../../components/organizations/RegistrationFlow';
import { organizationOverviewPath } from './agencyStatus';

export const PENDING_REVIEW_PATH = '/dashboard/super-admin/organizations?status=pending';
const reviewPath = (organizationId) => `${PENDING_REVIEW_PATH}&review=${organizationId}`;
const provisionPath = (organizationId) => `/dashboard/super-admin/admins?organization=${organizationId}&create=1`;
export const NO_ORGANIZATIONS = 'No student organizations yet. The Department Head registers them.';

export const needsAdministrator = (row) => row.lifecycle_status === 'active' && Number(row.administrators_count ?? 0) === 0;
const actionRank = (row) => {
  if (row.lifecycle_status === 'pending') return 0;
  if (needsAdministrator(row)) return 1;
  return (row.pending_approvals_count ?? 0) + (row.pending_documents_count ?? 0) > 0 ? 2 : 3;
};
const byAction = (left, right) => actionRank(left) - actionRank(right) || String(left.name || '').localeCompare(String(right.name || ''));

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function Count({ value }) {
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

export const hasAdministratorCount = (row) => row.administrators_count !== undefined && row.administrators_count !== null;

const TABLE_LAYOUT = 'overflow-x-auto [&_table]:min-w-[880px] [&_table]:table-fixed [&_th]:whitespace-normal [&_th]:px-3 [&_td]:px-3';
const COLUMN_WIDTHS = {
  withAdmins: '[&_th:nth-child(2)]:w-[26%] [&_th:nth-child(3)]:w-[9%] [&_th:nth-child(4)]:w-[8%] [&_th:nth-child(5)]:w-[15%] [&_th:nth-child(6)]:w-[20%]',
  withoutAdmins: '[&_th:nth-child(2)]:w-[26%] [&_th:nth-child(3)]:w-[9%] [&_th:nth-child(4)]:w-[17%] [&_th:nth-child(5)]:w-[20%]',
};

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
        <RegistrationRowStatus organization={row} viewerRole="SUPER_ADMIN" className="mt-2" />
      </span>
    ),
  },
  { key: 'members', header: 'Members', align: 'right', render: (row) => <Count value={row.member_counts?.total ?? 0} /> },
  { key: 'administrators', header: 'Admins', align: 'right', render: (row) => <Count value={row.administrators_count ?? 0} /> },
  { key: 'needs_attention', header: 'Needs attention', render: (row) => <NeedsAttention row={row} /> },
];

function rowActions(row) {
  const name = formatDisplayText(row.name);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {row.lifecycle_status === 'pending' && <Button to={reviewPath(row.id)} variant="secondary" size="sm" className="max-md:min-h-[42px]" aria-label={`Review ${name}`}>Review</Button>}
      {needsAdministrator(row) && <Button to={provisionPath(row.id)} variant="secondary" size="sm" className="max-md:min-h-[42px]" aria-label={`Provision administrator for ${name}`}>Provision administrator</Button>}
      <Button to={organizationOverviewPath(row.id)} variant="ghost" size="sm" className="max-md:min-h-[42px]" aria-label={`Open ${name}`}>Open</Button>
    </span>
  );
}

export function OrganizationsTable({ rows, caption, showAdmins }) {
  return (
    <div className={`${TABLE_LAYOUT} ${showAdmins ? COLUMN_WIDTHS.withAdmins : COLUMN_WIDTHS.withoutAdmins}`}>
      <DataTable
        columns={showAdmins ? COLUMNS : COLUMNS.filter((column) => column.key !== 'administrators')}
        rows={[...rows].sort(byAction)}
        caption={caption}
        actions={rowActions}
        emptyState={<p className="px-5 py-6 text-sm font-medium text-ink-muted">{NO_ORGANIZATIONS}</p>}
      />
    </div>
  );
}

export function actionCount(college) {
  return (college.by_lifecycle_status?.pending || 0) + (college.organizations || []).filter(needsAdministrator).length;
}

export function sortColleges(colleges) {
  return [...colleges].sort((left, right) => {
    const leftCounts = left.by_lifecycle_status || {};
    const rightCounts = right.by_lifecycle_status || {};
    return actionCount(right) - actionCount(left)
      || (rightCounts.returned || 0) - (leftCounts.returned || 0)
      || String(left.name || '').localeCompare(String(right.name || ''));
  });
}
