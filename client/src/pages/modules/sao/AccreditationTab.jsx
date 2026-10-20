import { useMemo, useState } from 'react';
import { Bell, Eye, FileText, ShieldCheck } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, FlowStepper, Input, ProgressMeter, StatusBadge } from '../../../components/ui';
import ComplianceReminderModal from './ComplianceReminderModal';
import { accreditationLifecycle } from '../../../lib/lifecycle';
import { accreditationBadge } from '../../roles/super-admin/agencyStatus';
import Modal from '../../../components/Modal';
import { manilaDate } from '../../../lib/format';
import TableRowActions from '../../../components/TableRowActions';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';

function orgApprovedCount(org) {
  return org.requirements.filter((requirement) => requirement.status === 'approved').length;
}

function orgPendingCount(org) {
  return org.requirements.filter((requirement) => requirement.status === 'submitted').length;
}

export default function AccreditationTab({ overview, onRetry, onReviewOrganization, role = 'SUPER_ADMIN' }) {
  const [search, setSearch] = useState('');
  const rows = useMemo(() => [...overview.organizations].sort((a, b) => String(a.organization_name).localeCompare(String(b.organization_name)) || a.organization_id - b.organization_id).filter((org) => org.organization_name.toLowerCase().includes(search.trim().toLowerCase())), [overview.organizations, search]);
  const [selectedId, setSelectedId] = useState(null);
  const [reminder, setReminder] = useState(null);
  const selected = rows.find((org) => org.organization_id === selectedId);

  async function viewFile(requirement) {
    try {
      await openProtectedFile(`/compliance/submissions/${requirement.submission_id}/document`);
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Could not open this document.'));
    }
  }

  const columns = [
    { key: 'organization_name', header: 'Organization', render: (org) => <strong>{org.organization_name}</strong> },
    {
      key: 'accreditation_status',
      header: 'Accreditation',
      render: (org) => {
        const badge = accreditationBadge(org.accreditation_status);
        const stage = accreditationLifecycle({ status: org.accreditation_status, total: org.requirements.length, approved: orgApprovedCount(org) }, role);
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
        <div className="min-w-[220px]">
          <ProgressMeter value={orgApprovedCount(org)} max={org.requirements.length || 1} valueLabel={`${orgApprovedCount(org)}/${org.requirements.length}`} />
        </div>
      ),
    },
  ];

  return (
    <>
    <Card title="Organization accreditation" description={overview.academicYear ? `Academic year ${overview.academicYear}` : 'No active requirements are configured for this academic year yet.'}>
      <DataTable
        stickyHeader={false}
        columns={columns}
        rowKey={(row) => row.organization_id}
        rows={rows}
        loading={overview.loading}
        error={overview.error}
        onRetry={onRetry}
        filters={<div className="mb-4"><Input type="search" aria-label="Search organizations" placeholder="Search organizations" value={search} onChange={(event) => setSearch(event.target.value)} /></div>}
        actions={(org) => <TableRowActions subject={org.organization_name} actions={[
          { label: 'View requirements', icon: Eye, onClick: () => setSelectedId(org.organization_id) },
          onReviewOrganization && orgPendingCount(org) > 0 && { label: `Review ${orgPendingCount(org)} submission${orgPendingCount(org) === 1 ? '' : 's'}`, icon: FileText, onClick: () => onReviewOrganization(org.organization_id) },
          org.requirements.some((item) => item.status !== 'approved') && { label: 'Send compliance reminder', icon: Bell, onClick: () => setReminder({ organization: org }) },
        ]} />}
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
    <Modal open={Boolean(selected)} title={selected?.organization_name || 'Requirement progress'} onClose={() => setSelectedId(null)} maxWidth="max-w-5xl">
      <DataTable
        caption={`Requirements for ${selected?.organization_name || 'organization'}`}
        stickyHeader={false}
        rowKey={(requirement) => requirement.requirement_type_id}
        rows={selected?.requirements || []}
        columns={[
          { key: 'name', header: 'Requirement', render: (requirement) => <div><strong>{requirement.requirement_name}</strong>{requirement.status === 'returned' && requirement.remarks && <p className="mt-1 text-xs text-danger-strong">SAO: {requirement.remarks}</p>}</div> },
          { key: 'deadline', header: 'Deadline', render: (requirement) => requirement.deadline_at ? manilaDate(requirement.deadline_at, 'long') : '—' },
          { key: 'submitted', header: 'Submitted', render: (requirement) => requirement.submitted_at ? manilaDate(requirement.submitted_at, 'long') : 'Not submitted' },
          { key: 'status', header: 'Status', render: (requirement) => <StatusBadge label={requirement.status === 'not_submitted' ? 'Not submitted' : requirement.status.replaceAll('_', ' ')} tone={requirement.status === 'approved' ? 'success' : requirement.status === 'returned' ? 'danger' : 'info'} /> },
          { key: 'file', header: 'File', render: (requirement) => <span className="break-all text-xs">{requirement.file_name || 'No file'}</span> },
        ]}
        actions={(requirement) => <TableRowActions subject={requirement.requirement_name} actions={[
          requirement.submission_id && { label: 'View file', icon: Eye, onClick: () => viewFile(requirement) },
          requirement.status !== 'approved' && { label: 'Send compliance reminder', icon: Bell, onClick: () => { setReminder({ organization: selected, requirementId: requirement.requirement_type_id }); setSelectedId(null); } },
        ]} />}
      />
      {onReviewOrganization && selected?.requirements.some((requirement) => requirement.status === 'submitted') && <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => { onReviewOrganization(selected.organization_id); setSelectedId(null); }}>Review submissions</Button></div>}
    </Modal>
    {reminder && <ComplianceReminderModal {...reminder} onClose={() => setReminder(null)} />}
    </>
  );
}
