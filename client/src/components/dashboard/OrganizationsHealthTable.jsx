import { Building2 } from 'lucide-react';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import OrgMark from '../ui/OrgMark';
import StatusBadge from '../ui/StatusBadge';
import { Meter } from '../charts';
import { number, relativeTime } from '../../lib/format';

const ACCREDITATION = {
  accredited: { tone: 'success', label: 'Accredited' },
  pending_review: { tone: 'warning', label: 'Pending Review' },
  incomplete: { tone: 'danger', label: 'Incomplete' },
  returned: { tone: 'danger', label: 'Returned' },
  not_applicable: { tone: 'neutral', label: 'Not Applicable' },
};

const COLUMNS = [
  {
    key: 'organization',
    header: 'Organization',
    render: (row) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <OrgMark name={row.name} acronym={row.abbreviation} size="sm" />
        <span className="truncate font-semibold text-ink">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'accreditation',
    header: 'Accreditation',
    render: (row) => {
      const status = ACCREDITATION[row.accreditation_status];
      return <StatusBadge status={row.accreditation_status} tone={status?.tone} label={status?.label} />;
    },
  },
  {
    key: 'budget',
    header: 'Budget utilization',
    render: (row) => (
      <div className="min-w-32">
        <Meter value={row.budget_utilization_percent} limit={100} label="Utilization" format={(value) => `${Math.round(value)}%`} />
      </div>
    ),
  },
  { key: 'reports', header: 'Reports pending', align: 'right', render: (row) => number(row.financial_reports_pending) },
  { key: 'elections', header: 'Open elections', align: 'right', render: (row) => number(row.open_elections) },
  {
    key: 'activity',
    header: 'Last activity',
    render: (row) => (row.last_activity_at ? relativeTime(row.last_activity_at) : 'No activity yet'),
  },
];

/**
 * ELEVATION_SPEC section 6, SUPER_ADMIN role emphasis: cross-organization
 * governance health from the briefing's `organizations` array (present for
 * SUPER_ADMIN only).
 */
export default function OrganizationsHealthTable({ organizations = [], loading = false, error = null, onRetry }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={organizations}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      caption="Organization governance health"
      emptyState={(
        <EmptyState
          kind="first-run"
          icon={Building2}
          title="No organizations yet"
          description="Organizations you register will appear here with their accreditation, budget, and reporting health."
        />
      )}
    />
  );
}
