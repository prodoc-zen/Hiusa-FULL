import { Check, ShieldCheck } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ProgressMeter, StatusBadge } from '../../../components/ui';

const ACCREDITATION_TONE = {
  accredited: 'success',
  pending_review: 'info',
  incomplete: 'warning',
  returned: 'danger',
  not_applicable: 'neutral',
};

const ACCREDITATION_LABEL = {
  accredited: 'Accredited',
  pending_review: 'Pending review',
  incomplete: 'Incomplete',
  returned: 'Returned',
  not_applicable: 'Not applicable',
};

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

export default function AccreditationTab({ overview, onRetry, onReviewOrganization }) {
  const columns = [
    { key: 'organization_name', header: 'Organization', render: (org) => <span className="font-bold text-ink">{org.organization_name}</span> },
    {
      key: 'accreditation_status',
      header: 'Accreditation',
      render: (org) => <StatusBadge tone={ACCREDITATION_TONE[org.accreditation_status] || 'neutral'} label={ACCREDITATION_LABEL[org.accreditation_status] || org.accreditation_status} />,
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
            <Button size="sm" variant="secondary" onClick={() => onReviewOrganization(org.organization_id)}>
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
        rows={overview.organizations}
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
