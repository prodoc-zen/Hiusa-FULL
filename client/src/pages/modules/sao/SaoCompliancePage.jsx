import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardList, ExternalLink, Plus, ShieldCheck, Undo2 } from 'lucide-react';
import {
  Button, Card, DataTable, EmptyState, Field, IconButton, Input, PageHeader,
  ProgressMeter, Select, StatusBadge, Tabs, Textarea,
} from '../../../components/ui';
import Modal from '../../../components/Modal';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getAcademicYears } from '../../../services/systemAdministrationService';
import {
  createRequirementType,
  getComplianceStatus,
  getRequirementTypes,
  getSubmissions,
  reviewSubmission,
  updateRequirementType,
  downloadSubmissionDocument,
} from '../../../services/complianceService';

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

const EMPTY_TYPE_FORM = { academic_year: '', name: '', description: '', deadline_at: '', is_active: true };

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

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

export default function SaoCompliancePage() {
  const role = useMemo(() => getCurrentRole(), []);

  const [activeTab, setActiveTab] = useState('overview');

  const [overview, setOverview] = useState({ loading: true, error: null, academicYear: null, organizations: [] });

  const [types, setTypes] = useState({ loading: true, error: null, items: [] });
  const [typeModal, setTypeModal] = useState(null);
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE_FORM);
  const [academicYears, setAcademicYears] = useState([]);
  const [typeFormError, setTypeFormError] = useState(null);
  const [typeSaving, setTypeSaving] = useState(false);

  const [queue, setQueue] = useState({ loading: true, error: null, items: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 20 } });
  const [queuePage, setQueuePage] = useState(1);
  const [queueStatus, setQueueStatus] = useState('submitted');
  const [queueOrg, setQueueOrg] = useState('');
  const [openingDocumentId, setOpeningDocumentId] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const loadOverview = useCallback(() => {
    setOverview((current) => ({ ...current, loading: true, error: null }));
    getComplianceStatus()
      .then((response) => {
        setOverview({
          loading: false,
          error: null,
          academicYear: response.data?.academic_year ?? null,
          organizations: Array.isArray(response.data?.organizations) ? response.data.organizations : [],
        });
      })
      .catch((err) => setOverview((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load accreditation status.') })));
  }, []);

  const loadTypes = useCallback(() => {
    setTypes((current) => ({ ...current, loading: true, error: null }));
    getRequirementTypes({ per_page: 100 })
      .then((response) => setTypes({ loading: false, error: null, items: unwrapList(response.data) }))
      .catch((err) => setTypes((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load requirement types.') })));
  }, []);

  const loadQueue = useCallback((page = 1) => {
    setQueue((current) => ({ ...current, loading: true, error: null }));
    getSubmissions({
      page,
      status: queueStatus || undefined,
      organization_id: queueOrg || undefined,
    })
      .then((response) => setQueue({ loading: false, error: null, items: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((err) => setQueue((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load the review queue.') })));
  }, [queueStatus, queueOrg]);

  useEffect(() => { if (role === 'SUPER_ADMIN') loadOverview(); }, [loadOverview, role]);
  useEffect(() => { if (role === 'SUPER_ADMIN') getAcademicYears().then(setAcademicYears).catch(() => setAcademicYears([])); }, [role]);
  useEffect(() => { if (role === 'SUPER_ADMIN') loadTypes(); }, [loadTypes, role]);
  useEffect(() => { if (role === 'SUPER_ADMIN') loadQueue(queuePage); }, [loadQueue, queuePage, role]);
  useEffect(() => { setQueuePage(1); }, [queueStatus, queueOrg]);

  function openTypeModal(type = null) {
    setTypeFormError(null);
    setTypeModal({ mode: type ? 'edit' : 'create', type });
    setTypeForm(type ? {
      academic_year: type.academic_year || '',
      name: type.name || '',
      description: type.description || '',
      deadline_at: String(type.deadline_at || '').slice(0, 10),
      is_active: type.is_active !== false,
    } : { ...EMPTY_TYPE_FORM, academic_year: overview.academicYear || '' });
  }

  async function handleTypeSubmit(event) {
    event.preventDefault();
    if (!typeForm.academic_year.trim() || !typeForm.name.trim() || !typeForm.deadline_at) {
      setTypeFormError('Complete the academic year, name, and deadline before saving.');
      return;
    }

    setTypeSaving(true);
    setTypeFormError(null);
    const payload = {
      academic_year: typeForm.academic_year.trim(),
      name: typeForm.name.trim(),
      description: typeForm.description.trim() || null,
      deadline_at: typeForm.deadline_at,
      is_active: typeForm.is_active,
    };

    try {
      if (typeModal.mode === 'edit') {
        await updateRequirementType(typeModal.type.id, payload);
        notify.success('Requirement updated.');
      } else {
        await createRequirementType(payload);
        notify.success('Requirement added. Every active organization has been notified.');
      }
      setTypeModal(null);
      loadTypes();
      loadOverview();
    } catch (err) {
      setTypeFormError(getApiErrorMessage(err, 'Could not save this requirement.'));
    } finally {
      setTypeSaving(false);
    }
  }

  async function toggleTypeActive(type) {
    try {
      await updateRequirementType(type.id, { is_active: !type.is_active });
      notify.success(type.is_active ? `"${type.name}" marked inactive.` : `"${type.name}" marked active.`);
      loadTypes();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not update this requirement.'));
    }
  }

  async function openDocument(submission) {
    const preview = window.open('', '_blank');
    if (!preview) {
      notify.error('Allow pop-ups to open this document.');
      return;
    }
    setOpeningDocumentId(submission.id);
    try {
      const response = await downloadSubmissionDocument(submission.id);
      const url = URL.createObjectURL(response.data);
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      preview.close();
      notify.error(getApiErrorMessage(err, 'Could not open this document.'));
    } finally {
      setOpeningDocumentId(null);
    }
  }

  async function confirmApprove() {
    setReviewBusy(true);
    try {
      await reviewSubmission(reviewTarget.submission.id, { status: 'approved', submitted_at: reviewTarget.submission.submitted_at });
      notify.success(`Approved "${reviewTarget.submission.requirement_type?.name}" for ${reviewTarget.submission.organization?.name}.`);
      setReviewTarget(null);
      loadQueue(queuePage);
      loadOverview();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not approve this submission.'));
      if (err?.response?.status === 409) loadQueue(queuePage);
    } finally {
      setReviewBusy(false);
    }
  }

  async function confirmReturn() {
    if (!reviewRemarks.trim()) return;
    setReviewBusy(true);
    try {
      await reviewSubmission(reviewTarget.submission.id, { status: 'returned', remarks: reviewRemarks.trim(), submitted_at: reviewTarget.submission.submitted_at });
      notify.success('Submission returned to the organization with your remarks.');
      setReviewTarget(null);
      setReviewRemarks('');
      loadQueue(queuePage);
      loadOverview();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not return this submission.'));
    } finally {
      setReviewBusy(false);
    }
  }

  if (role !== 'SUPER_ADMIN') {
    return (
      <div className="space-y-5">
        <PageHeader title="Compliance and accreditation" description="Track every organization's accreditation status and review submitted documents." />
        <Card><EmptyState kind="restricted" title="SAO access only" description="Only the Student Affairs Office can review organization compliance." /></Card>
      </div>
    );
  }

  const overviewColumns = [
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setQueueOrg(String(org.organization_id)); setQueueStatus('submitted'); setActiveTab('queue'); }}
            >
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

  const typeColumns = [
    { key: 'name', header: 'Requirement', render: (type) => <span className="font-bold text-ink">{type.name}</span> },
    { key: 'academic_year', header: 'Academic year' },
    { key: 'deadline_at', header: 'Deadline', render: (type) => manilaDate(type.deadline_at, 'long') },
    { key: 'is_active', header: 'Status', render: (type) => <StatusBadge status={type.is_active ? 'active' : 'inactive'} /> },
    { key: 'description', header: 'Description', render: (type) => <RichTextBody as="span" value={type.description || 'No description.'} className="line-clamp-2 text-ink-muted" /> },
  ];

  const queueColumns = [
    { key: 'organization', header: 'Organization', render: (submission) => submission.organization?.name || 'Unknown' },
    { key: 'requirement', header: 'Requirement', render: (submission) => submission.requirement_type?.name || 'Unknown' },
    { key: 'submitted_at', header: 'Submitted', render: (submission) => manilaDate(submission.submitted_at, 'long') },
    { key: 'submitted_by', header: 'Submitted by', render: (submission) => (submission.submitter ? `${submission.submitter.first_name} ${submission.submitter.last_name}` : 'Unknown') },
    { key: 'status', header: 'Status', render: (submission) => <StatusBadge status={submission.status} /> },
  ];

  const queueFiltersActive = Boolean(queueOrg) || queueStatus !== 'submitted';

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Compliance and accreditation"
        description="See who is behind on their requirements, manage what every organization must submit, and review what has come in."
      />

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: 'overview', label: 'Overview', icon: ShieldCheck },
          { key: 'requirements', label: 'Requirement types', icon: ClipboardList },
          { key: 'queue', label: 'Review queue', icon: Check },
        ]}
      />

      {activeTab === 'overview' && (
        <Card title="Organization accreditation" description={overview.academicYear ? `Academic year ${overview.academicYear}` : 'No active requirements are configured for this academic year yet.'}>
          <DataTable
            columns={overviewColumns}
            rowKey={(row) => row.organization_id}
            rows={overview.organizations}
            loading={overview.loading}
            error={overview.error}
            onRetry={loadOverview}
            emptyState={(
              <EmptyState
                kind="first-run"
                icon={ShieldCheck}
                title="No organizations to track yet"
                description="Once organizations are onboarded, their accreditation status against this year's requirements will appear here."
              />
            )}
          />
        </Card>
      )}

      {activeTab === 'requirements' && (
        <Card
          title="Requirement catalog"
          description="What every organization must submit, and by when."
          actions={<Button leftIcon={Plus} onClick={() => openTypeModal()}>New requirement</Button>}
        >
          <DataTable
            columns={typeColumns}
            rows={types.items}
            loading={types.loading}
            error={types.error}
            onRetry={loadTypes}
            actions={(type) => (
              <div className="flex justify-end gap-1.5">
                <IconButton icon={type.is_active ? Undo2 : Check} label={type.is_active ? 'Mark inactive' : 'Mark active'} onClick={() => toggleTypeActive(type)} />
                <Button size="sm" variant="secondary" onClick={() => openTypeModal(type)}>Edit</Button>
              </div>
            )}
            emptyState={(
              <EmptyState
                kind="first-run"
                icon={ClipboardList}
                title="No requirements defined yet"
                description="Add the documents every organization must submit for accreditation this academic year."
                action={<Button leftIcon={Plus} onClick={() => openTypeModal()}>New requirement</Button>}
              />
            )}
          />
        </Card>
      )}

      {activeTab === 'queue' && (
        <Card title="Review queue" description="Open a submission's document, then approve it or return it with remarks.">
          <DataTable
            columns={queueColumns}
            rows={queue.items}
            loading={queue.loading}
            error={queue.error}
            onRetry={() => loadQueue(queuePage)}
            filtersActive={queueFiltersActive}
            filters={(
              <div className="flex flex-col gap-3 border-b border-line bg-surface p-3 sm:flex-row sm:items-center sm:p-4">
                <Select aria-label="Filter by status" value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)} className="sm:w-56">
                  <option value="submitted">Awaiting review</option>
                  <option value="approved">Approved</option>
                  <option value="returned">Returned</option>
                  <option value="">All statuses</option>
                </Select>
                <Select aria-label="Filter by organization" value={queueOrg} onChange={(event) => setQueueOrg(event.target.value)} className="sm:w-56">
                  <option value="">All organizations</option>
                  {overview.organizations.map((org) => <option key={org.organization_id} value={org.organization_id}>{org.organization_name}</option>)}
                </Select>
                {queueFiltersActive && (
                  <Button variant="ghost" size="sm" onClick={() => { setQueueStatus('submitted'); setQueueOrg(''); }}>Clear filters</Button>
                )}
                <p className="text-xs font-semibold tabular-nums text-ink-muted sm:ml-auto">
                  {queue.meta.total} {queue.meta.total === 1 ? 'submission' : 'submissions'}
                </p>
              </div>
            )}
            actions={(submission) => (
              <div className="flex justify-end gap-1.5">
                <IconButton
                  icon={ExternalLink}
                  label="Open document"
                  onClick={() => openDocument(submission)}
                  disabled={openingDocumentId === submission.id}
                />
                {submission.status === 'submitted' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setReviewTarget({ submission, action: 'return' })}>Return</Button>
                    <Button size="sm" onClick={() => setReviewTarget({ submission, action: 'approve' })}>Approve</Button>
                  </>
                )}
              </div>
            )}
            pagination={(
              <PaginationControls
                currentPage={queue.meta.currentPage}
                totalItems={queue.meta.total}
                pageSize={queue.meta.perPage}
                onPageChange={setQueuePage}
                label="submissions"
              />
            )}
            emptyState={(
              <EmptyState
                kind="first-run"
                icon={Check}
                title="Nothing waiting on you"
                description="Submissions from organizations will land here for your review as they come in."
              />
            )}
          />
        </Card>
      )}

      <Modal
        open={Boolean(typeModal)}
        title={typeModal?.mode === 'edit' ? 'Edit requirement' : 'New requirement'}
        description="This requirement applies to every active organization for the academic year you set."
        onClose={typeSaving ? undefined : () => setTypeModal(null)}
        closeOnEscape={!typeSaving}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setTypeModal(null)} disabled={typeSaving}>Cancel</Button>
            <Button onClick={handleTypeSubmit} loading={typeSaving}>{typeModal?.mode === 'edit' ? 'Save changes' : 'Add requirement'}</Button>
          </>
        )}
      >
        <form onSubmit={handleTypeSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Academic year" required>
            <select autoFocus value={typeForm.academic_year} onChange={(event) => setTypeForm({ ...typeForm, academic_year: event.target.value })} className="h-11 w-full rounded-lg border border-line-soft bg-white px-3 text-sm">
              <option value="">Choose academic year</option>
              {academicYears.map((year) => <option key={year.id} value={year.label}>{year.label}{year.is_current ? ' · Current' : ''}</option>)}
            </select>
          </Field>
          <Field label="Deadline" required>
            <Input type="date" value={typeForm.deadline_at} onChange={(event) => setTypeForm({ ...typeForm, deadline_at: event.target.value })} />
          </Field>
          <Field label="Name" required className="sm:col-span-2">
            <Input placeholder="e.g. Accomplishment report" value={typeForm.name} onChange={(event) => setTypeForm({ ...typeForm, name: event.target.value })} />
          </Field>
          <Field label="Description" hint="Shown to organizations alongside this requirement." className="sm:col-span-2">
            <RichTextEditor ariaLabel="Requirement description" value={typeForm.description} onChange={(description) => setTypeForm({ ...typeForm, description })} rows={4} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink sm:col-span-2">
            <input type="checkbox" role="switch" aria-checked={typeForm.is_active} className="h-4 w-4 accent-brand-700" checked={typeForm.is_active} onChange={(event) => setTypeForm({ ...typeForm, is_active: event.target.checked })} />
            Active (organizations must submit against this requirement)
          </label>
          {typeFormError && <p role="alert" className="text-sm font-semibold text-danger-strong sm:col-span-2">{typeFormError}</p>}
        </form>
      </Modal>

      <ConfirmModal
        open={reviewTarget?.action === 'approve'}
        title="Approve this submission?"
        message="The organization will be notified and this document will be locked from further edits."
        recordName={reviewTarget?.submission ? `${reviewTarget.submission.requirement_type?.name} - ${reviewTarget.submission.organization?.name}` : ''}
        confirmText="Approve"
        variant="primary"
        busy={reviewBusy}
        onCancel={() => setReviewTarget(null)}
        onConfirm={confirmApprove}
      />

      <Modal
        open={reviewTarget?.action === 'return'}
        title="Return this submission"
        description="A remark is required so the organization knows what to fix."
        onClose={reviewBusy ? undefined : () => { setReviewTarget(null); setReviewRemarks(''); }}
        closeOnEscape={!reviewBusy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => { setReviewTarget(null); setReviewRemarks(''); }} disabled={reviewBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmReturn} loading={reviewBusy} disabled={!reviewRemarks.trim()}>Return to organization</Button>
          </>
        )}
      >
        <Field label="Remarks" required hint="Explain what needs to be corrected before resubmission.">
          <Textarea data-autofocus value={reviewRemarks} onChange={(event) => setReviewRemarks(event.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
