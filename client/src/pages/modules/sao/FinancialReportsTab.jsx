import { formatDisplayText, signatoryLabel } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Check, Download, ExternalLink, Eye, X } from 'lucide-react';
import { Button, Drawer, EmptyState, ErrorState, Field, Input, Select, SkeletonTable, StatusBadge, Textarea } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import {
  downloadFinancialReportPdf,
  getFinancialReport,
  getFinancialReports,
} from '../../../services/financeService';
import { fetchAllPages } from '../../../services/pagination';
import { getSystemOrganizations } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import TableRowActions from '../../../components/TableRowActions';

const date = (value) => value
  ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Not set';
const STATUS_LABEL = { pending_sao: 'Awaiting SAO review', approved: 'Approved', rejected: 'Rejected' };
const statusLabel = (value) => STATUS_LABEL[value || 'pending_sao'] || String(value).replaceAll('_', ' ');
const documentLabel = (value) => value === 'income_statement' ? 'Income Statement' : 'Financial Report';

function downloadBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function FinancialReportsTab({ initialOrganizationId = '' }) {
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [reports, setReports] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState(new Map());
  const [meta, setMeta] = useState({ current_page: 1, per_page: 20, total: 0 });
  const [filters, setFilters] = useState({ search: '', status: '', document_type: '' });
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const [reviewAction, setReviewAction] = useState(null);
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = Object.fromEntries(Object.entries({
        page,
        per_page: 20,
        organization_id: organizationId || undefined,
        ...filters,
      }).filter(([, value]) => value !== '' && value !== undefined));
      const [reportResponse, approvalResponse] = await Promise.all([
        getFinancialReports(params),
        getApprovalRequests({ status: 'pending', entity_type: 'financial_report', per_page: 100, organization_id: organizationId || undefined }),
      ]);
      setReports(reportResponse.data.data || []);
      setMeta(reportResponse.data);
      setPendingApprovals(new Map((approvalResponse.data.data || []).map((approval) => [Number(approval.entity_id), approval])));
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Unable to load financial reports.'));
    } finally {
      setLoading(false);
    }
  }, [filters, organizationId]);

  useEffect(() => {
    fetchAllPages(getSystemOrganizations)
      .then(setOrganizations)
      .catch(() => setOrganizations([]));
  }, []);
  useEffect(() => { load(1); }, [load]);

  async function openReport(report) {
    try {
      setDetail((await getFinancialReport(report.id)).data);
    } catch (error) {
      setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to open the report.') });
    }
  }

  async function downloadReport(report) {
    setDownloadingId(report.id);
    try {
      const response = await downloadFinancialReportPdf(report.id);
      const prefix = report.document_type === 'income_statement' ? 'income-statement' : 'financial-report';
      downloadBlob(response, `${prefix}-${report.id}.pdf`);
      setFeedback({ open: true, type: 'success', message: 'PDF downloaded.' });
    } catch (error) {
      setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to download the PDF.') });
    } finally {
      setDownloadingId(null);
    }
  }

  async function openDocument(document) {
    try {
      await openProtectedFile(document.open_url);
    } catch (error) {
      setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to open the document.') });
    }
  }

  async function submitReview() {
    if (!reviewAction) return;
    setReviewing(true);
    try {
      await reviewApprovalRequest(reviewAction.approval.id, {
        status: reviewAction.status,
        ...(reviewAction.status === 'rejected' ? { remarks: rejectionRemarks.trim() } : {}),
      });
      setReviewAction(null);
      setRejectionRemarks('');
      setDetail(null);
      setFeedback({ open: true, type: 'success', message: `Financial report ${reviewAction.status}.` });
      await load(meta.current_page || 1);
    } catch (error) {
      setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to review the financial report.') });
    } finally {
      setReviewing(false);
    }
  }

  const clearFilters = () => {
    setOrganizationId(initialOrganizationId);
    setFilters({ search: '', status: '', document_type: '' });
  };

  const detailApproval = detail?.report ? pendingApprovals.get(Number(detail.report.id)) : null;

  const filtersActive = Boolean(filters.search.trim() || filters.status || filters.document_type || (!initialOrganizationId && organizationId));

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted-strong">Reports organizations submitted for SAO review. Decide each one here.</p>
      {loadError && <div role="alert"><ErrorState title="Could not load reports" description={loadError} retryLabel="Retry" onRetry={() => load(meta.current_page || 1)} /></div>}

      <div className="flex flex-wrap items-center gap-3">
        <Input type="search" aria-label="Search report titles" className="w-full sm:w-64" placeholder="Search report titles" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
        {!initialOrganizationId && <Select filter aria-label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="sm:w-56">
          <option value="">All organizations</option>
          {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.acronym} - {formatDisplayText(organization.name)}</option>)}
        </Select>}
        <Select filter aria-label="Document type" value={filters.document_type} onChange={(event) => setFilters((current) => ({ ...current, document_type: event.target.value }))} className="sm:w-48">
          <option value="">All document types</option>
          <option value="financial_report">Financial reports</option>
          <option value="income_statement">Income statements</option>
        </Select>
        <Select filter aria-label="Report status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="sm:w-48">
          <option value="">All statuses</option>
          <option value="pending_sao">Awaiting SAO review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        {filtersActive && <button type="button" onClick={clearFilters} className="inline-flex min-h-[42px] items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
        <p className="text-xs tabular-nums text-ink-muted sm:ml-auto">{meta.total || 0} {meta.total === 1 ? 'financial report' : 'financial reports'}</p>
      </div>

      <section aria-label="Report inbox">
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : reports.length ? (
          <div className="divide-y divide-line border-y border-line">
            {reports.map((report) => {
              const approval = pendingApprovals.get(Number(report.id));
              const decided = report.submission_status === 'approved' || report.submission_status === 'rejected';
              return (
                <article key={report.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{formatDisplayText(report.title)}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{report.organization?.acronym || formatDisplayText(report.organization?.name)} · {documentLabel(report.document_type)} · {date(report.submitted_at || report.generated_at)}</p>
                  </div>
                  {decided
                    ? <StatusBadge status={report.submission_status} />
                    : <span className="text-sm text-ink-muted">{statusLabel(report.submission_status)}</span>}
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" className="max-sm:h-[42px]" leftIcon={Eye} onClick={() => openReport(report)}>View</Button>
                    <TableRowActions subject={formatDisplayText(report.title)} actions={[
                      { label: 'View report', icon: Eye, onClick: () => openReport(report) },
                      { label: 'Download PDF', icon: Download, disabled: downloadingId === report.id, onClick: () => downloadReport(report) },
                      approval && { label: 'Approve', icon: Check, onClick: () => setReviewAction({ approval, status: 'approved', report }) },
                      approval && { label: 'Reject', icon: X, danger: true, onClick: () => setReviewAction({ approval, status: 'rejected', report }) },
                    ]} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            kind={filtersActive ? 'filtered' : 'first-run'}
            title="No financial reports found."
            description={filtersActive ? 'Try a different search or clear the filters.' : 'Reports appear here after a Department Head approves them.'}
            onClearFilters={filtersActive ? clearFilters : undefined}
          />
        )}
        <PaginationControls currentPage={meta.current_page || 1} totalItems={meta.total || 0} pageSize={meta.per_page || 20} onPageChange={load} label="financial reports" />
      </section>

      <Drawer
        open={Boolean(detail)}
        title={formatDisplayText(detail?.report?.title) || 'Financial report'}
        description={detail?.report ? `${detail.report.organization?.name || ''} · ${documentLabel(detail.report.document_type)} · ${statusLabel(detail.report.submission_status)}` : ''}
        onClose={() => setDetail(null)}
        width="max-w-2xl"
        footer={detail?.report && <>
          <Button variant="secondary" leftIcon={Download} onClick={() => downloadReport(detail.report)} disabled={downloadingId === detail.report.id}>Download PDF</Button>
          {detailApproval && <>
            <Button variant="secondary" leftIcon={X} onClick={() => setReviewAction({ approval: detailApproval, status: 'rejected', report: detail.report })}>Reject</Button>
            <Button leftIcon={Check} onClick={() => setReviewAction({ approval: detailApproval, status: 'approved', report: detail.report })}>Approve</Button>
          </>}
        </>}
      >
        {detail && <div className="space-y-4">
          <p className="text-sm text-ink-muted-strong">{detail.report.summary_text}</p>
          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Required signatories</h3>
            {Object.entries(detail.report.signatories || {}).map(([role, name]) => <p key={role} className="mt-2 text-sm text-ink-muted-strong">{signatoryLabel(role)}: <span className="font-medium text-ink">{formatDisplayText(name)}</span></p>)}
          </div>
          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Supporting documents</h3>
            {(detail.report.supporting_documents || []).map((document) => <button key={document.index} type="button" onClick={() => openDocument(document)} className="mt-2 flex min-h-[42px] items-center gap-2 text-left text-sm font-medium text-brand-700 hover:underline"><ExternalLink size={14} aria-hidden="true" />{document.name}</button>)}
            {!(detail.report.supporting_documents || []).length && <p className="mt-2 text-sm text-ink-muted">No supporting documents were attached.</p>}
          </div>
        </div>}
      </Drawer>

      <ConfirmModal
        open={reviewAction?.status === 'approved'}
        title="Approve financial report"
        message="Confirm that the submitted report and its supporting documents are ready for final acceptance."
        recordName={reviewAction?.report?.title}
        confirmText="Approve report"
        variant="primary"
        busy={reviewing}
        onCancel={() => !reviewing && setReviewAction(null)}
        onConfirm={submitReview}
      />

      <Modal
        open={reviewAction?.status === 'rejected'}
        title="Reject financial report"
        description="The organization sees your reason."
        onClose={reviewing ? undefined : () => { setReviewAction(null); setRejectionRemarks(''); }}
        closeOnBackdrop={!reviewing}
        closeOnEscape={!reviewing}
        maxWidth="max-w-md"
        footer={<>
          <Button variant="secondary" disabled={reviewing} onClick={() => { setReviewAction(null); setRejectionRemarks(''); }}>Cancel</Button>
          <Button variant="danger" loading={reviewing} disabled={!rejectionRemarks.trim()} onClick={submitReview}>Reject report</Button>
        </>}
      >
        <Field label="Rejection reason">
          <Textarea value={rejectionRemarks} onChange={(event) => setRejectionRemarks(event.target.value)} rows={4} placeholder="Say what is missing or incorrect." />
        </Field>
      </Modal>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback((value) => ({ ...value, open: false }))} />
    </div>
  );
}
