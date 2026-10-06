import { formatDisplayText } from '../../../utils/displayText.js';
import FieldIcon from '../../../components/FieldIcon.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Eye, FileText, RefreshCw, X } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import TableFilterBar from '../../../components/TableFilterBar';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import {
  downloadFinancialReportPdf,
  getFinancialReport,
  getFinancialReports,
} from '../../../services/financeService';
import { getSystemOrganizations } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';

const date = (value) => value
  ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Not set';
const statusLabel = (value) => String(value || 'pending_sao').replaceAll('_', ' ');
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

export default function SuperAdminFinancialReportsPage() {
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState('');
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
        getApprovalRequests({ status: 'pending', entity_type: 'financial_report', per_page: 100 }),
      ]);
      setReports(reportResponse.data.data || []);
      setMeta(reportResponse.data);
      setPendingApprovals(new Map((approvalResponse.data.data || []).map((approval) => [Number(approval.entity_id), approval])));
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Unable to load received financial reports.'));
    } finally {
      setLoading(false);
    }
  }, [filters, organizationId]);

  useEffect(() => {
    getSystemOrganizations({ per_page: 100 })
      .then((data) => setOrganizations(data.data || []))
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

  const activeFilters = useMemo(() => [
    filters.search.trim() && `Search: ${filters.search.trim()}`,
    organizationId && `Organization: ${organizations.find((organization) => String(organization.id) === String(organizationId))?.acronym || organizationId}`,
    filters.status && `Status: ${statusLabel(filters.status)}`,
    filters.document_type && `Document: ${documentLabel(filters.document_type)}`,
  ].filter(Boolean), [filters, organizationId, organizations]);

  const clearFilters = () => {
    setOrganizationId('');
    setFilters({ search: '', status: '', document_type: '' });
  };

  const detailApproval = detail?.report ? pendingApprovals.get(Number(detail.report.id)) : null;

  return (
    <div className="space-y-5">
      {loadError && (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold">{loadError}</p>
          <button type="button" onClick={() => load(meta.current_page || 1)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-xs font-bold text-red-700 hover:bg-red-100">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
        <TableFilterBar
          searchValue={filters.search}
          onSearchChange={(value) => setFilters((current) => ({ ...current, search: value }))}
          searchPlaceholder="Search report titles"
          activeFilters={activeFilters}
          onClear={clearFilters}
          resultCount={meta.total || 0}
          resultLabel={meta.total === 1 ? 'received report' : 'received reports'}
          secondaryClassName="grid gap-3 sm:grid-cols-3"
        >
          <select aria-label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm focus:border-[#0B8ED0] focus:outline-none">
            <option value="">All organizations</option>
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.acronym} - {formatDisplayText(organization.name)}</option>)}
          </select>
          <select aria-label="Document type" value={filters.document_type} onChange={(event) => setFilters((current) => ({ ...current, document_type: event.target.value }))} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm focus:border-[#0B8ED0] focus:outline-none">
            <option value="">All document types</option>
            <option value="financial_report">Financial reports</option>
            <option value="income_statement">Income statements</option>
          </select>
          <select aria-label="Report status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm focus:border-[#0B8ED0] focus:outline-none">
            <option value="">All received statuses</option>
            <option value="pending_sao">Awaiting SAO review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </TableFilterBar>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
        <div className="border-b border-[#DDE7EF] px-5 py-4">
          <h2 className="font-bold text-[#0F172A]">Report inbox</h2>
          <p className="mt-1 text-xs text-slate-500">Only reports that completed Department Head review appear here.</p>
        </div>
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500">Loading received reports...</p>
        ) : reports.length ? (
          <div className="divide-y divide-[#DDE7EF]">
            {reports.map((report) => {
              const approval = pendingApprovals.get(Number(report.id));
              return (
                <article key={report.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0F2F62]"><FileText size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#0F172A]">{formatDisplayText(report.title)}</p>
                    <p className="mt-1 text-xs text-slate-500">{report.organization?.acronym || formatDisplayText(report.organization?.name)} · {documentLabel(report.document_type)} · {date(report.submitted_at || report.generated_at)}</p>
                  </div>
                  <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${approval ? 'bg-amber-100 text-amber-800' : report.submission_status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}`}>{statusLabel(report.submission_status)}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => downloadReport(report)} disabled={downloadingId === report.id} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-slate-700 hover:bg-[#F8FBFD] disabled:opacity-50"><Download size={14} />{downloadingId === report.id ? 'Downloading' : 'PDF'}</button>
                    <button type="button" onClick={() => openReport(report)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-3 text-xs font-bold text-white hover:bg-[#0F2F62]"><Eye size={14} />View</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="font-semibold text-[#0F172A]">No received reports found.</p>
            <p className="mt-1 text-sm text-slate-500">Only reports approved by a Department Head appear here. A notification about a report deadline does not mean a report has been submitted.</p>
          </div>
        )}
        <PaginationControls currentPage={meta.current_page || 1} totalItems={meta.total || 0} pageSize={meta.per_page || 20} onPageChange={load} label="received reports" />
      </section>

      <Modal
        open={Boolean(detail)}
        title={formatDisplayText(detail?.report?.title) || 'Financial report'}
        description={detail?.report ? `${detail.report.organization?.name || ''} · ${documentLabel(detail.report.document_type)} · ${statusLabel(detail.report.submission_status)}` : ''}
        onClose={() => setDetail(null)}
        maxWidth="max-w-4xl"
        footer={detail?.report && <>
          <button type="button" onClick={() => downloadReport(detail.report)} disabled={downloadingId === detail.report.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-700"><Download size={15} />Download PDF</button>
          {detailApproval && <>
            <button type="button" onClick={() => setReviewAction({ approval: detailApproval, status: 'rejected', report: detail.report })} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700"><X size={15} />Reject</button>
            <button type="button" onClick={() => setReviewAction({ approval: detailApproval, status: 'approved', report: detail.report })} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white"><Check size={15} />Approve</button>
          </>}
        </>}
      >
        {detail && <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">{detail.report.summary_text}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[#DDE7EF] p-4">
              <h3 className="text-sm font-bold text-[#0F172A]">Required signatories</h3>
              {Object.entries(detail.report.signatories || {}).map(([role, name]) => <p key={role} className="mt-2 text-sm capitalize text-slate-600">{role.replaceAll('_', ' ')}: <strong>{formatDisplayText(name)}</strong></p>)}
            </div>
            <div className="rounded-lg border border-[#DDE7EF] p-4">
              <h3 className="text-sm font-bold text-[#0F172A]">Supporting documents</h3>
              {(detail.report.supporting_documents || []).map((document) => <a key={document.path} href={resolveAssetUrl(document.url)} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 text-sm font-bold text-[#0878B7]"><Download size={14} />{document.name}</a>)}
              {!(detail.report.supporting_documents || []).length && <p className="mt-2 text-sm text-slate-500">No supporting documents were attached.</p>}
            </div>
          </div>
        </div>}
      </Modal>

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
        description="State what the organization must correct before resubmitting."
        onClose={reviewing ? undefined : () => { setReviewAction(null); setRejectionRemarks(''); }}
        closeOnBackdrop={!reviewing}
        closeOnEscape={!reviewing}
        maxWidth="max-w-md"
        footer={<>
          <button type="button" disabled={reviewing} onClick={() => { setReviewAction(null); setRejectionRemarks(''); }} className="min-h-10 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-700">Cancel</button>
          <button type="button" disabled={reviewing || !rejectionRemarks.trim()} onClick={submitReview} className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50">{reviewing ? 'Rejecting...' : 'Reject report'}</button>
        </>}
      >
        <label className="block text-sm font-semibold text-[#0F172A]"><FieldIcon label="Rejection reason" />Rejection reason
          <textarea value={rejectionRemarks} onChange={(event) => setRejectionRemarks(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-lg border border-[#DDE7EF] p-3 text-sm focus:border-[#0B8ED0] focus:outline-none" placeholder="Describe the missing or incorrect report details." />
        </label>
      </Modal>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback((value) => ({ ...value, open: false }))} />
    </div>
  );
}
