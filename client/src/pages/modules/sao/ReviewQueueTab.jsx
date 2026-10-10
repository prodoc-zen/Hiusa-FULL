import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, Field, FlowStepper, IconButton, NextStep, Select, StatusBadge, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { toNextStepProps } from '../../../lib/lifecycle';
import useRecordParam from '../../../lib/useRecordParam';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { downloadSubmissionDocument, getSubmissions, reviewSubmission } from '../../../services/complianceService';
import { complianceStage, complianceStageText } from './complianceStage';

const DEFAULT_STATUS = 'submitted';
const ROW_ACTION = 'h-11! sm:h-9!';

function documentKind(name) {
  return /semestral/i.test(name || '') ? 'Semestral report' : 'Renewal document';
}

function stageInput(submission) {
  return { status: submission.status, remarks: submission.remarks, requirement_name: submission.requirement_type?.name };
}

export default function ReviewQueueTab({ organizations, filters, onFiltersChange, onChanged }) {
  const { organizationId, status } = filters;
  const [recordId, setRecordId] = useRecordParam();
  const [pinned, setPinned] = useState(null);
  const [queue, setQueue] = useState({ loading: true, error: null, items: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 20 } });
  const [page, setPage] = useState(1);
  const [openingDocumentId, setOpeningDocumentId] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [remarksError, setRemarksError] = useState(null);
  const remarksRef = useRef(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  const loadQueue = useCallback((target = 1) => {
    setQueue((current) => ({ ...current, loading: true, error: null }));
    getSubmissions({
      page: target,
      status: status || undefined,
      organization_id: organizationId || undefined,
    })
      .then((response) => setQueue({ loading: false, error: null, items: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((err) => setQueue((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load the review queue.') })));
  }, [status, organizationId]);

  useEffect(() => { loadQueue(page); }, [loadQueue, page]);
  useEffect(() => { setPage(1); }, [status, organizationId]);

  const found = recordId ? queue.items.find((item) => String(item.id) === recordId) ?? null : null;
  const openSubmission = found ?? (pinned && String(pinned.id) === recordId ? pinned : null);

  useEffect(() => {
    if (found) setPinned(found);
  }, [found]);

  // A deep link can name a submission on a later page, so walk the pages until it turns up.
  useEffect(() => {
    if (!recordId || openSubmission || queue.loading || queue.error) return;
    if (page < queue.meta.lastPage) {
      setPage(page + 1);
      return;
    }
    notify.error('That submission is not in the review queue.');
    setRecordId(null);
  }, [recordId, openSubmission, queue.loading, queue.error, queue.meta.lastPage, page, setRecordId]);

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

  function closeReview() {
    setReviewTarget(null);
    setReviewRemarks('');
    setRemarksError(null);
  }

  async function runReview(payload, successMessage, failureMessage) {
    setReviewBusy(true);
    setReviewError(null);
    try {
      await reviewSubmission(reviewTarget.submission.id, { ...payload, submitted_at: reviewTarget.submission.submitted_at });
      setPinned({ ...reviewTarget.submission, status: payload.status, remarks: payload.remarks ?? reviewTarget.submission.remarks });
      notify.success(successMessage);
      closeReview();
      loadQueue(page);
      onChanged();
    } catch (err) {
      const message = getApiErrorMessage(err, failureMessage);
      if (err?.response?.status === 409) {
        setReviewError(message);
        closeReview();
        loadQueue(page);
      } else {
        notify.error(message);
      }
    } finally {
      setReviewBusy(false);
    }
  }

  function confirmApprove() {
    const { submission } = reviewTarget;
    return runReview(
      { status: 'approved' },
      `Approved "${submission.requirement_type?.name}" for ${submission.organization?.name}.`,
      'Could not approve this submission.',
    );
  }

  function confirmReturn() {
    if (!reviewRemarks.trim()) {
      setRemarksError('Write what the organization needs to correct before returning this submission.');
      remarksRef.current?.focus();
      return Promise.resolve();
    }
    return runReview(
      { status: 'returned', remarks: reviewRemarks.trim() },
      'Submission returned to the organization with your remarks.',
      'Could not return this submission.',
    );
  }

  const columns = [
    { key: 'organization', header: 'Organization', render: (submission) => <button type="button" onClick={() => { setPinned(submission); setRecordId(submission.id); }} className="text-left font-bold text-ink hover:text-brand-700">{submission.organization?.name || 'Unknown'}</button> },
    {
      key: 'requirement',
      header: 'Requirement',
      render: (submission) => (
        <div>
          <p>{submission.requirement_type?.name || 'Unknown'}</p>
          <p className="text-xs font-medium text-ink-muted">{documentKind(submission.requirement_type?.name)}</p>
        </div>
      ),
    },
    { key: 'submitted_at', header: 'Submitted', render: (submission) => manilaDate(submission.submitted_at, 'long') },
    { key: 'submitted_by', header: 'Submitted by', render: (submission) => (submission.submitter ? `${submission.submitter.first_name} ${submission.submitter.last_name}` : 'Unknown') },
    {
      key: 'status',
      header: 'Status',
      render: (submission) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={submission.status} />
          <span className="text-xs font-semibold text-ink-muted-strong">{complianceStageText(stageInput(submission))}</span>
        </div>
      ),
    },
  ];

  const filtersActive = Boolean(organizationId) || status !== DEFAULT_STATUS;

  return (
    <Card title="Review queue" description="Open a submission's document, then approve it or return it with remarks.">
      {reviewError && (
        <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{reviewError}</p>
      )}
      <DataTable
        stickyHeader={false}
        columns={columns}
        rows={queue.items}
        loading={queue.loading}
        error={queue.error}
        onRetry={() => loadQueue(page)}
        filtersActive={filtersActive}
        filters={(
          <div className="flex flex-col gap-3 border-b border-line bg-surface p-3 sm:flex-row sm:items-center sm:p-4">
            <Select aria-label="Filter by status" value={status} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })} className="sm:w-56">
              <option value="submitted">Awaiting review</option>
              <option value="approved">Approved</option>
              <option value="returned">Returned</option>
              <option value="">All statuses</option>
            </Select>
            <Select aria-label="Filter by organization" value={organizationId} onChange={(event) => onFiltersChange({ ...filters, organizationId: event.target.value })} className="sm:w-56">
              <option value="">All organizations</option>
              {organizations.map((org) => <option key={org.organization_id} value={org.organization_id}>{org.organization_name}</option>)}
            </Select>
            {filtersActive && (
              <Button variant="ghost" size="sm" className={ROW_ACTION} onClick={() => onFiltersChange({ organizationId: '', status: DEFAULT_STATUS })}>Clear filters</Button>
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
              label={`Open ${submission.requirement_type?.name || 'document'} for ${submission.organization?.name || 'organization'}`}
              onClick={() => openDocument(submission)}
              disabled={openingDocumentId === submission.id}
            />
            {submission.status === 'submitted' && (
              <>
                <Button size="sm" variant="secondary" className={ROW_ACTION} onClick={() => { setReviewError(null); setReviewTarget({ submission, action: 'return' }); }}>Return</Button>
                <Button size="sm" className={ROW_ACTION} onClick={() => { setReviewError(null); setReviewTarget({ submission, action: 'approve' }); }}>Approve</Button>
              </>
            )}
          </div>
        )}
        pagination={(
          <PaginationControls
            currentPage={queue.meta.currentPage}
            totalItems={queue.meta.total}
            pageSize={queue.meta.perPage}
            onPageChange={setPage}
            label="submissions"
          />
        )}
        emptyState={filtersActive ? (
          <EmptyState
            kind="filtered"
            title="No submissions match these filters"
            description="Try a different status or organization, or clear the filters."
            onClearFilters={() => onFiltersChange({ organizationId: '', status: DEFAULT_STATUS })}
          />
        ) : (
          <EmptyState
            kind="first-run"
            icon={Check}
            title="Nothing to review"
            description="Organization admins upload each requirement from their Compliance page. Every submission lands here for your decision."
          />
        )}
      />

      <Drawer
        open={Boolean(openSubmission)}
        title={openSubmission ? (openSubmission.requirement_type?.name || 'Submission') : undefined}
        description={openSubmission ? openSubmission.organization?.name : undefined}
        onClose={() => setRecordId(null)}
      >
        {openSubmission && (
          <div className="flex flex-col gap-4">
            <FlowStepper steps={complianceStage(stageInput(openSubmission)).steps} ariaLabel="Compliance submission progress" />
            <NextStep {...toNextStepProps(complianceStage(stageInput(openSubmission), 'SUPER_ADMIN'))} primary={undefined} />
            <dl className="grid gap-3 text-sm">
              <div><dt className="text-xs font-semibold text-ink-muted">Submitted</dt><dd className="font-bold text-ink">{manilaDate(openSubmission.submitted_at, 'long')}</dd></div>
              <div><dt className="text-xs font-semibold text-ink-muted">Submitted by</dt><dd className="font-bold text-ink">{openSubmission.submitter ? `${openSubmission.submitter.first_name} ${openSubmission.submitter.last_name}` : 'Unknown'}</dd></div>
              {openSubmission.remarks && <div><dt className="text-xs font-semibold text-ink-muted">SAO remarks</dt><dd className="font-medium text-ink">{openSubmission.remarks}</dd></div>}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" leftIcon={ExternalLink} onClick={() => openDocument(openSubmission)} disabled={openingDocumentId === openSubmission.id}>Open document</Button>
              {openSubmission.status === 'submitted' && (
                <>
                  <Button variant="secondary" onClick={() => { setReviewError(null); setReviewTarget({ submission: openSubmission, action: 'return' }); }}>Return</Button>
                  <Button onClick={() => { setReviewError(null); setReviewTarget({ submission: openSubmission, action: 'approve' }); }}>Approve</Button>
                </>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={reviewTarget?.action === 'approve'}
        title="Approve this submission?"
        message="The organization will be notified and this document will be locked from further edits."
        recordName={reviewTarget?.submission ? `${reviewTarget.submission.requirement_type?.name} - ${reviewTarget.submission.organization?.name}` : ''}
        confirmText="Approve"
        variant="primary"
        busy={reviewBusy}
        onCancel={closeReview}
        onConfirm={confirmApprove}
      />

      <Modal
        open={reviewTarget?.action === 'return'}
        title="Return this submission"
        description="A remark is required so the organization knows what to fix."
        onClose={reviewBusy ? undefined : closeReview}
        closeOnEscape={!reviewBusy}
        footer={(
          <>
            <Button variant="secondary" onClick={closeReview} disabled={reviewBusy}>Cancel</Button>
            <Button variant="secondary" onClick={confirmReturn} loading={reviewBusy}>Return to organization</Button>
          </>
        )}
      >
        <Field label="Remarks" required error={remarksError} hint="Explain what needs to be corrected before resubmission.">
          <Textarea ref={remarksRef} data-autofocus value={reviewRemarks} onChange={(event) => { setReviewRemarks(event.target.value); setRemarksError(null); }} />
        </Field>
      </Modal>
    </Card>
  );
}
