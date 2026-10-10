import { useMemo } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, FlowStepper, ProgressMeter, StatusBadge } from '../../../components/ui';
import { accreditationLifecycle } from '../../../lib/lifecycle';
import { accreditationBadge } from '../../roles/super-admin/agencyStatus';

function orgApprovedCount(org) {
  return org.requirements.filter((requirement) => requirement.status === 'approved').length;
}

function orgOverdueCount(org) {
  const now = Date.now();
  return org.requirements.filter((requirement) => requirement.status !== 'approved'
    && requirement.deadline_at && new Date(requirement.deadline_at).getTime() < now).length;
}

function orgPendingCount(org) {
  return org.requirements.filter((requirement) => requirement.status === 'submitted').length;
}

const ACCREDITATION_RANK = { pending_review: 1, returned: 2, incomplete: 3, accredited: 4 };

function attentionRank(org) {
  if (orgOverdueCount(org) > 0) return 0;
  return ACCREDITATION_RANK[org.accreditation_status] ?? 5;
}

function sortByAttention(organizations) {
  return [...organizations].sort((a, b) => attentionRank(a) - attentionRank(b)
    || String(a.organization_name).localeCompare(String(b.organization_name)));
}

export default function AccreditationTab({ overview, onRetry, onReviewOrganization }) {
  const rows = useMemo(() => sortByAttention(overview.organizations), [overview.organizations]);

  const columns = [
    { key: 'organization_name', header: 'Organization', render: (org) => <span className="font-bold text-ink">{org.organization_name}</span> },
    {
      key: 'accreditation_status',
      header: 'Accreditation',
      render: (org) => {
        const badge = accreditationBadge(org.accreditation_status);
        const stage = accreditationLifecycle({ status: org.accreditation_status, total: org.requirements.length, approved: orgApprovedCount(org) }, 'SUPER_ADMIN');
        return (
          <div className="flex min-w-[170px] flex-col items-start gap-1.5">
            <StatusBadge tone={badge.tone} label={badge.label} />
            <FlowStepper variant="compact" steps={stage.steps} ariaLabel={`Accreditation progress for ${org.organization_name}`} />
          </div>
        );
      },
    },
    {
      key: 'progress',
      header: 'Requirements met',
      render: (org) => (
        <div className="min-w-[140px]">
          <ProgressMeter value={orgApprovedCount(org)} max={org.requirements.length || 1} valueLabel={`${orgApprovedCount(org)}/${org.requirements.length}`} />
        </div>
      ),
    },
    {
      key: 'overdue',
      header: 'Overdue',
      align: 'right',
      render: (org) => {
        const overdue = orgOverdueCount(org);
        return overdue > 0
          ? <span className="font-bold text-danger-strong">{overdue}</span>
          : <span className="text-ink-muted">0</span>;
      },
    },
    {
      key: 'next_action',
      header: 'Next action',
      render: (org) => {
        const pending = orgPendingCount(org);
        if (pending > 0) {
          return (
            <Button size="sm" variant="secondary" className="h-11! sm:h-9!" onClick={() => onReviewOrganization(org.organization_id)}>
              Review {pending} submission{pending === 1 ? '' : 's'}
            </Button>
          );
        }
        if (org.accreditation_status === 'incomplete') return <span className="text-sm font-medium text-ink-muted">Awaiting submission</span>;
        if (org.accreditation_status === 'returned') return <span className="text-sm font-medium text-ink-muted">Waiting on the organization</span>;
        if (org.accreditation_status === 'accredited') {
          return <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success-strong"><Check size={14} aria-hidden="true" />All caught up</span>;
        }
        return <span className="text-sm font-medium text-ink-muted">No active requirements</span>;
      },
    },
  ];

  return (
    <Card title="Organization accreditation" description={overview.academicYear ? `Academic year ${overview.academicYear}` : 'No active requirements are configured for this academic year yet.'}>
      <DataTable
        stickyHeader={false}
        columns={columns}
        rowKey={(row) => row.organization_id}
        rows={rows}
        loading={overview.loading}
        error={overview.error}
        onRetry={onRetry}
        emptyState={(
          <EmptyState
            kind="first-run"
            icon={ShieldCheck}
            title="No organizations to track yet"
            description="Once organizations are active, their accreditation status against this year's requirements will appear here."
          />
        )}
      />
    </Card>
  );
}
