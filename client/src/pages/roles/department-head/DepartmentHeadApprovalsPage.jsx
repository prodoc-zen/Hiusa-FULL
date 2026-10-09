import { formatDisplayText } from '../../../utils/displayText.js';
import DateTimeInput from '../../../components/ui/DateTimeInput.jsx';
import FieldIcon from '../../../components/FieldIcon.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, Coins, Download, Eye, FileText, Megaphone, Package, Search, Vote, X } from 'lucide-react';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import notify from '../../../lib/notify';
import PaginationControls from '../../../components/PaginationControls';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { downloadFinancialReportPdf } from '../../../services/financeService';
import { getCollegeOrganizations } from '../../../services/collegeOrganizationService';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../../utils/apiError';

const PAGE_SIZE = 20;

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

const ENTITY_ICON = {
  event: CalendarDays,
  budget: Coins,
  election: Vote,
  announcement: Megaphone,
  payment: Package,
  financial_report: FileText,
};

const ENTITY_LABEL = {
  event: 'Event',
  budget: 'Budget',
  election: 'Election',
  announcement: 'Announcement',
  payment: 'Payment',
  financial_report: 'Financial Report',
};

const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
};

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

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

function downloadCsv(rows, organizationNames) {
  const headers = ['Request ID', 'Organization', 'Type', 'Title', 'Status', 'Requester ID', 'Requester', 'Role', 'Position', 'Department', 'Program', 'Year Level', 'Section', 'Requested At', 'Reviewer', 'Reviewed At', 'Remarks'];
  const values = rows.map((item) => [item.id, organizationNames[item.organization_id] || '', item.entity_type, item.title, item.status, item.requester?.school_id, `${item.requester?.first_name || ''} ${item.requester?.last_name || ''}`.trim(), item.requester?.role, item.requester?.position_title, item.requester?.department, item.requester?.program, item.requester?.year_level, item.requester?.section, item.requested_at, `${item.reviewer?.first_name || ''} ${item.reviewer?.last_name || ''}`.trim(), item.reviewed_at, item.remarks]);
  const csv = [headers, ...values].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `approval-register-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

function summaryLine(entityType, summary) {
  if (!summary) return null;

  if (entityType === 'event') {
    return `${formatDate(summary.start_time)} - ${formatDate(summary.end_time)}${summary.location ? ` | ${summary.location}` : ''}`;
  }

  if (entityType === 'budget') {
    const amount = Number(summary.allocated_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Allocation: ₱${amount}${summary.event_title ? ` | ${summary.event_title}` : ''}`;
  }

  if (entityType === 'election') {
    return `${formatDate(summary.start_time)} - ${formatDate(summary.end_time)} | Requested status: ${summary.target_status || 'upcoming'}`;
  }

  if (entityType === 'announcement') {
    return `Audience: ${summary.target_role || 'all'} | Category: ${summary.category || 'general'} | Status: ${summary.approval_status || 'pending'}`;
  }

  if (entityType === 'payment') {
    const total = Number(summary.total_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${summary.item || 'Merchandise'} | Buyer: ${summary.buyer || 'Unknown'} | ₱${total}${summary.payment_reference ? ` | Ref: ${summary.payment_reference}` : ''}`;
  }

  if (entityType === 'financial_report') {
    const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const advances = Number(summary.cash_advances_released) > 0 || Number(summary.cash_advance_repayments) > 0
      ? ` | Cash advances released ${peso(summary.cash_advances_released)} | Cash advance repayments ${peso(summary.cash_advance_repayments)}`
      : '';
    return `${summary.organization?.acronym || 'Organization'} | ${formatDate(summary.period_start)} - ${formatDate(summary.period_end)} | Inflows ${peso(summary.total_income)} | Outflows ${peso(summary.total_expense)}${advances}`;
  }

  return null;
}

function ApprovalReceipt({ request, organizationName }) {
  const rows = [
    ['Request number', `#${request.id}`],
    ...(organizationName ? [['Organization', organizationName]] : []),
    ['Type', ENTITY_LABEL[request.entity_type] || request.entity_type],
    ['Status', <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_BADGE[request.status] || 'bg-slate-100 text-slate-700'}`}>{request.status}</span>],
    ['Required role', request.required_role],
    ['Requester', `${request.requester?.first_name || ''} ${request.requester?.last_name || ''}`.trim() || '-'],
    ['School ID', request.requester?.school_id || '-'],
    ['Email', request.requester?.email],
    ['Role / position', [request.requester?.role, request.requester?.position_title].filter(Boolean).join(' · ')],
    ['Department', request.requester?.department],
    ['Academic profile', [request.requester?.program, request.requester?.year_level, request.requester?.section].filter(Boolean).join(' · ')],
    ['Submitted', formatDateTime(request.requested_at)],
    ['Record ID', request.entity_id],
    ['Reviewer', `${request.reviewer?.first_name || ''} ${request.reviewer?.last_name || ''}`.trim() || '-'],
    ['Reviewed', formatDateTime(request.reviewed_at)],
  ];
  return <section className="border-y-2 border-[#0F2F62] bg-white py-3"><h4 className="pb-3 text-sm font-black text-[#0F2F62]">{formatDisplayText(request.title)}</h4><dl className="border-t border-[#DDE7EF] sm:grid sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-[#DDE7EF] py-2 pr-2 text-xs"><dt className="font-bold text-[#64748B]">{label}</dt><dd className="break-words font-semibold text-[#0F172A]">{value || '-'}</dd></div>)}</dl><div className="py-3 text-xs leading-5 text-[#0F172A]"><strong className="block text-[#64748B]">Record summary</strong>{summaryLine(request.entity_type, request.summary) || 'No additional summary available.'}</div>{request.status !== 'pending' && <p className="border-t border-[#DDE7EF] pt-3 text-xs"><strong>Review remarks:</strong> {request.remarks || 'No remarks recorded.'}</p>}</section>;
}

function ReviewModal({ open, request, action, onCancel, onConfirm, busy, organizationName }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (open) setRemarks('');
  }, [open]);

  if (!open || !request) return null;

  const isReject = action === 'rejected';

  return (
    <AccessibleOverlay label={`${isReject ? 'Reject' : 'Approve'} request`} onClose={() => !busy && onCancel()} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">
          {isReject ? 'Reject' : 'Approve'} "{formatDisplayText(request.title)}"
        </h3>
        <div className="mt-4"><ApprovalReceipt request={request} organizationName={organizationName} /></div>
        <div className="mt-4 space-y-1.5">
          <label className="text-[13px] font-semibold text-[#0F172A]">
           <FieldIcon label="Remarks" /> Remarks {isReject ? '' : '(optional)'}
          </label>
          <textarea
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            rows={3}
            placeholder={isReject ? 'e.g. Budget not yet finalized.' : 'Optional note for the requester...'}
            className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(remarks)}
            disabled={busy || (isReject && !remarks.trim())}
            className={`h-11 rounded-lg px-5 text-sm font-bold text-white transition disabled:opacity-50 ${isReject ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0878B7] hover:bg-[#0F2F62]'}`}
          >
            {busy ? 'Processing...' : isReject ? 'Reject' : 'Approve'}
          </button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

export default function DepartmentHeadApprovalsPage() {
  const [requests, setRequests] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [pendingTotal, setPendingTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [details, setDetails] = useState(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [modalState, setModalState] = useState({ open: false, request: null, action: null });
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const isDepartmentHead = useMemo(() => getCurrentRole() === 'DEPARTMENT_HEAD', []);
  const [organizations, setOrganizations] = useState([]);
  const [organizationFilter, setOrganizationFilter] = useState('all');
  const organizationNames = useMemo(() => Object.fromEntries(organizations.map((organization) => [organization.id, organization.name])), [organizations]);

  useEffect(() => {
    if (!isDepartmentHead) return;
    fetchAllPages((params) => getCollegeOrganizations(params).then((res) => res.data))
      .then(setOrganizations)
      .catch(() => notify.error('Could not load the organizations of your college.'));
  }, [isDepartmentHead]);

  async function openDocument(document) {
    try {
      await openProtectedFile(document.open_url);
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Unable to open this document.'));
    }
  }

  async function downloadReportPdf() {
    if (!details?.entity_id) return;
    setPdfDownloading(true);
    try {
      const response = await downloadFinancialReportPdf(details.entity_id);
      downloadBlob(response, `financial-report-${details.entity_id}.pdf`);
    } catch {
      setDetails(null);
      setError('Unable to download the submitted financial report PDF.');
    } finally {
      setPdfDownloading(false);
    }
  }

  // Hoisted so the CSV export can reuse the exact same filter set as the
  // loaded page, without page/per_page, via fetchAllPages.
  const queryParams = useMemo(() => ({
    status: statusFilter,
    entity_type: entityFilter === 'all' ? undefined : entityFilter,
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
    sort,
  }), [statusFilter, entityFilter, search, from, to, sort]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // The "Pending (n)" tab label always names the pending queue, even while
    // viewing "All History", so it is read from its own totals-only request
    // rather than from whichever status is currently loaded into `requests`.
    // The approvals API has no organization filter, so one organization is
    // narrowed client-side over every page and paged locally.
    const requestPage = organizationFilter === 'all'
      ? getApprovalRequests({ ...queryParams, page }).then((res) => ({ rows: unwrapList(res.data), meta: listMeta(res.data) }))
      : fetchAllPages((params) => getApprovalRequests(params).then((res) => res.data), queryParams).then((all) => {
        const matching = all.filter((request) => String(request.organization_id) === organizationFilter);
        return {
          rows: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
          meta: { total: matching.length, currentPage: page, lastPage: Math.max(1, Math.ceil(matching.length / PAGE_SIZE)), perPage: PAGE_SIZE },
        };
      });
    Promise.all([
      requestPage,
      getApprovalRequests({ status: 'pending', per_page: 1 }),
    ])
      .then(([result, pendingRes]) => {
        setRequests(result.rows);
        setMeta(result.meta);
        setPendingTotal(listMeta(pendingRes.data).total);
      })
      .catch(() => setError('Failed to load approval requests.'))
      .finally(() => setLoading(false));
  }, [queryParams, page, organizationFilter]);

  async function handleExport() {
    setExporting(true);
    try {
      const all = await fetchAllPages((params) => getApprovalRequests(params).then((res) => res.data), queryParams);
      downloadCsv(organizationFilter === 'all' ? all : all.filter((request) => String(request.organization_id) === organizationFilter), organizationNames);
    } catch {
      setError('Failed to export approval requests.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [statusFilter, entityFilter, search, from, to, sort, organizationFilter]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleReview(remarks) {
    const { request, action } = modalState;
    setSubmitting(true);
    try {
      await reviewApprovalRequest(request.id, { status: action, remarks: remarks.trim() || null });
      setModalState({ open: false, request: null, action: null });
      notify.success(`Request ${action}.`);
      load();
    } catch {
      setError('Failed to submit review. Please try again.');
      notify.error('Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {['pending', 'all'].map((tab) => (
          <button
            key={tab}
            onClick={() => { setStatusFilter(tab); setPage(1); }}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              statusFilter === tab
                ? 'bg-[#0878B7] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'border border-[#DDE7EF] bg-white text-slate-600 hover:bg-[#F8FBFD]'
            }`}
          >
            {tab === 'pending' ? `Pending${pendingTotal ? ` (${pendingTotal})` : ''}` : 'All History'}
          </button>
        ))}
      </div>

      <section className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm">
        <div className={`grid gap-3 md:grid-cols-2 ${isDepartmentHead ? 'xl:grid-cols-7' : 'xl:grid-cols-6'}`}>
          <label className="relative xl:col-span-2">
            <Search size={15} className="absolute left-3 top-3.5 text-slate-500" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requester, ID, remarks..." className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]" />
          </label>
          <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
            <option value="all">All request types</option>{Object.entries(ENTITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {isDepartmentHead && (
            <select aria-label="Organization" value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
              <option value="all">All organizations</option>{organizations.map((organization) => <option key={organization.id} value={String(organization.id)}>{organization.name}</option>)}
            </select>
          )}
          <DateTimeInput type="date" aria-label="Requested from" value={from} onChange={(event) => setFrom(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
          <DateTimeInput type="date" aria-label="Requested to" value={to} onChange={(event) => setTo(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
          <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">{meta.total} matching request{meta.total === 1 ? '' : 's'} · {pendingTotal} awaiting action</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setSearch(''); setEntityFilter('all'); setOrganizationFilter('all'); setFrom(''); setTo(''); setSort('newest'); }} className="h-9 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-slate-600">Reset</button>
            <button type="button" onClick={handleExport} disabled={!meta.total || exporting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0878B7] px-3 text-xs font-bold text-white disabled:opacity-50"><Download size={14} /> {exporting ? 'Exporting...' : 'Export CSV'}</button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      <section className="rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? (
          <div className="space-y-2 p-5">
            {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="py-14 text-center">
            <Clock size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-500">
              {statusFilter === 'pending' ? 'Nothing waiting for review.' : 'No approval history yet.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#DDE7EF]">
            {requests.map((request) => {
              const Icon = ENTITY_ICON[request.entity_type] || Clock;
              return (
                <div key={request.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[#0F172A]">{formatDisplayText(request.title)}</p>
                        <span className="rounded-full border border-[#DDE7EF] bg-[#F8FBFD] px-2 py-0.5 text-[11px] font-bold text-slate-500">
                          {ENTITY_LABEL[request.entity_type] || request.entity_type}
                        </span>
                        {organizationNames[request.organization_id] && (
                          <span className="rounded-full border border-[#DDE7EF] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0F2F62]">
                            {organizationNames[request.organization_id]}
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_BADGE[request.status]}`}>
                          {request.status}
                        </span>
                      </div>
                      {summaryLine(request.entity_type, request.summary) && (
                        <p className="mt-1 text-xs text-slate-500">{summaryLine(request.entity_type, request.summary)}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        Requested by {request.requester ? `${formatDisplayText(request.requester.first_name)} ${formatDisplayText(request.requester.last_name)}` : 'Unknown'} ({request.requester?.school_id || 'No ID'}) | {formatDateTime(request.requested_at)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{[request.requester?.role, request.requester?.position_title, request.requester?.program, request.requester?.year_level, request.requester?.section].filter(Boolean).join(' · ') || 'No requester profile details'}</p>
                      {request.status !== 'pending' && request.remarks && (
                        <p className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                          <span className="font-semibold">Remarks:</span> {request.remarks}
                        </p>
                      )}
                    </div>
                  </div>

                  {request.status === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => setDetails(request)} className="inline-flex h-[42px] sm:h-9 items-center gap-1.5 rounded-md border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Eye size={13} /> Details</button>
                      <button
                        onClick={() => setModalState({ open: true, request, action: 'approved' })}
                        className="inline-flex h-[42px] sm:h-9 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        <Check size={13} /> Approve
                      </button>
                      <button
                        onClick={() => setModalState({ open: true, request, action: 'rejected' })}
                        className="inline-flex h-[42px] sm:h-9 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        <X size={13} /> Reject
                      </button>
                    </div>
                  )}
                  {request.status !== 'pending' && <button onClick={() => setDetails(request)} className="inline-flex h-[42px] sm:h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Eye size={13} /> Details</button>}
                </div>
              );
            })}
          </div>
        )}
        {!loading && requests.length > 0 && (
          <PaginationControls
            currentPage={meta.currentPage}
            totalItems={meta.total}
            pageSize={meta.perPage}
            onPageChange={setPage}
            label="requests"
          />
        )}
      </section>

      <ReviewModal
        open={modalState.open}
        request={modalState.request}
        action={modalState.action}
        busy={submitting}
        organizationName={organizationNames[modalState.request?.organization_id]}
        onCancel={() => setModalState({ open: false, request: null, action: null })}
        onConfirm={handleReview}
      />

      {details && (
        <AccessibleOverlay label="Approval request details" onClose={() => setDetails(null)} closeOnBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0878B7]">Request #{details.id} · {ENTITY_LABEL[details.entity_type]}</p><h3 className="mt-1 text-xl font-black text-[#0F172A]">{formatDisplayText(details.title)}</h3></div><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-5"><ApprovalReceipt request={details} organizationName={organizationNames[details.organization_id]} /></div>
            {details.entity_type === 'financial_report' && <>
              <button type="button" onClick={downloadReportPdf} disabled={pdfDownloading} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white hover:bg-[#0F2F62] disabled:opacity-50"><Download size={15}/>{pdfDownloading ? 'Preparing PDF...' : 'Download submitted report'}</button>
              <div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Required signatories</p>{Object.entries(details.summary?.signatories || {}).map(([role, name]) => <p key={role} className="mt-2 text-sm capitalize text-slate-600">{role.replaceAll('_', ' ')}: <strong>{formatDisplayText(name)}</strong></p>)}</div><div className="rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Supporting documents</p>{(details.summary?.supporting_documents || []).map((document) => <button key={document.index} type="button" onClick={() => openDocument(document)} className="mt-2 flex min-h-11 items-center gap-2 text-left text-sm font-bold text-[#0878B7] hover:underline"><Download size={14}/>{document.name}</button>)}{!(details.summary?.supporting_documents || []).length && <p className="mt-2 text-sm text-slate-500">No supporting documents.</p>}</div></div>
            </>}
          </div>
        </AccessibleOverlay>
      )}
    </div>
  );
}
