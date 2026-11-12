import { useMemo, useState } from 'react';
import { Bell, Check, Eye, FileText, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, FlowStepper, Input, ProgressMeter, StatusBadge } from '../../../components/ui';
import FileReviewList from '../../../components/reviews/FileReviewList';
import ComplianceReminderModal from './ComplianceReminderModal';
import { accreditationLifecycle } from '../../../lib/lifecycle';
import { accreditationBadge } from '../../roles/super-admin/agencyStatus';
import { manilaDate } from '../../../lib/format';
import TableRowActions from '../../../components/TableRowActions';
import { reviewSubmission } from '../../../services/complianceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';
import useActiveSubAccount from '../../../hooks/useActiveSubAccount';

function orgApprovedCount(org) {
  return org.requirements.filter((requirement) => requirement.status === 'approved').length;
}

function orgPendingCount(org) {
  return org.requirements.filter((requirement) => requirement.status === 'submitted').length;
}

export default function AccreditationTab({ title = 'Organization accreditation', overview, onRetry, onReviewOrganization, onChanged, role = 'SUPER_ADMIN' }) {
  const [search, setSearch] = useState('');
  const { subAccountId } = useActiveSubAccount();
  const rows = useMemo(() => [...overview.organizations].sort((a, b) => String(a.organization_name).localeCompare(String(b.organization_name)) || a.organization_id - b.organization_id).filter((org) => (!subAccountId || Number(org.organization_id) === subAccountId) && org.organization_name.toLowerCase().includes(search.trim().toLowerCase())), [overview.organizations, search, subAccountId]);
  const [selectedId, setSelectedId] = useState(null);
  const [reminder, setReminder] = useState(null);
  const [fileComments, setFileComments] = useState({});
  const [fileBusyId, setFileBusyId] = useState(null);
  const selected = rows.find((org) => org.organization_id === selectedId);

  async function decideFile(requirement, status) {
    if (!requirement.submission_id) return;
    const comment = (fileComments[requirement.submission_id] || '').trim();
    if (status === 'returned' && !comment) {
      notify.error('Enter a comment for this file before returning it.');
      return;
    }
    setFileBusyId(requirement.submission_id);
    try {
      await reviewSubmission(requirement.submission_id, {
        status,
        ...(comment ? { remarks: comment } : {}),
        submitted_at: requirement.submitted_at,
      });
      notify.success(status === 'approved' ? `"${requirement.requirement_name}" approved.` : `"${requirement.requirement_name}" returned with your comment.`);
      onChanged?.();
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Could not update this submission.'));
    } finally {
      setFileBusyId(null);
    }
  }

  const columns = [
    { key: 'organization_name', header: 'Organization', render: (org) => <span className="font-medium text-ink">{org.organization_name}</span> },
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
          <ProgressMeter kind="progress" value={orgApprovedCount(org)} max={org.requirements.length || 1} valueLabel={`${orgApprovedCount(org)}/${org.requirements.length}`} />
        </div>
      ),
    },
  ];

  // One aligned row per requirement. The deadline, the SAO's earlier remarks and the SAO's own decision controls sit under the row.
  const requirementRows = (selected?.requirements || []).map((requirement) => {
    const dates = [
      requirement.deadline_at && `Deadline ${manilaDate(requirement.deadline_at, 'long')}`,
      requirement.submitted_at && `Submitted ${manilaDate(requirement.submitted_at, 'long')}`,
    ].filter(Boolean).join(' · ');
    const returnedRemarks = requirement.status === 'returned' && requirement.remarks;
    const deciding = role === 'SUPER_ADMIN' && requirement.submission_id && requirement.status === 'submitted';
    const busy = fileBusyId === requirement.submission_id;
    return {
      id: requirement.requirement_type_id,
      name: requirement.requirement_name,
      status: requirement.status === 'not_submitted'
        ? { label: 'Not submitted', tone: 'neutral' }
        : { label: requirement.status.charAt(0).toUpperCase() + requirement.status.slice(1).replaceAll('_', ' '), tone: requirement.status === 'approved' ? 'success' : requirement.status === 'returned' ? 'danger' : 'info' },
      file: requirement.submission_id ? { name: requirement.file_name || requirement.requirement_name, url: `/compliance/submissions/${requirement.submission_id}/document` } : null,
      emptyFile: 'No file',
      actions: requirement.status !== 'approved'
        ? [{ label: 'Remind', ariaLabel: `Send compliance reminder for ${requirement.requirement_name}`, onClick: () => { setReminder({ organization: selected, requirementId: requirement.requirement_type_id }); setSelectedId(null); } }]
        : [],
      expanded: true,
      note: dates || returnedRemarks ? (
        <div className="space-y-1">
          {dates && <p className="text-xs text-ink-muted-strong">{dates}</p>}
          {returnedRemarks && <p className="text-xs text-danger-strong">SAO: {requirement.remarks}</p>}
        </div>
      ) : null,
      detail: deciding ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="text"
            aria-label={`Comment for ${requirement.requirement_name}`}
            placeholder="Comment (required to return)"
            value={fileComments[requirement.submission_id] ?? (requirement.remarks || '')}
            onChange={(e) => setFileComments((curr) => ({ ...curr, [requirement.submission_id]: e.target.value }))}
            className="min-w-[200px] flex-1"
          />
          <Button size="sm" variant="secondary" leftIcon={Check} loading={busy} onClick={() => decideFile(requirement, 'approved')}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" leftIcon={RotateCcw} loading={busy} onClick={() => decideFile(requirement, 'returned')}>
            Return
          </Button>
        </div>
      ) : null,
    };
  });

  return (
    <>
    <Card title={title} description={overview.academicYear ? `Academic year ${overview.academicYear}` : 'No active requirements are configured for this academic year yet.'}>
      <DataTable
        stickyHeader={false}
        caption={`${title} by organization`}
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
        emptyState={search.trim() ? (
          <EmptyState kind="filtered" query={search.trim()} onClearFilters={() => setSearch('')} />
        ) : (
          <EmptyState
            kind="first-run"
            icon={ShieldCheck}
            title="No organizations to track yet"
            description="Once organizations are active, their accreditation status against this year's requirements will appear here."
          />
        )}
      />
    </Card>
    <Drawer open={Boolean(selected)} title={selected?.organization_name || 'Requirement progress'} onClose={() => setSelectedId(null)} width="max-w-4xl">
      {requirementRows.length > 0 ? (
        <section aria-label={`Requirements for ${selected?.organization_name || 'organization'}`} className="overflow-hidden rounded-card border border-line">
          <FileReviewList rows={requirementRows} />
        </section>
      ) : (
        <EmptyState kind="first-run" title="No requirements yet" description="Requirements appear here once the SAO publishes them for this academic year." />
      )}
      {onReviewOrganization && selected?.requirements.some((requirement) => requirement.status === 'submitted') && <div className="mt-4 flex justify-end"><Button onClick={() => { onReviewOrganization(selected.organization_id); setSelectedId(null); }}>Review submissions</Button></div>}
    </Drawer>
    {reminder && <ComplianceReminderModal {...reminder} onClose={() => setReminder(null)} />}
    </>
  );
}
