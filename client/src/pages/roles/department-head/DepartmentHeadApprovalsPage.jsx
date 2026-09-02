import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Clock, Coins, Download, Eye, Megaphone, Package, Search, Vote, X } from 'lucide-react';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import PaginationControls from '../../../components/PaginationControls';
import { listMeta, unwrapList } from '../../../services/pagination';

const ENTITY_ICON = {
  event: CalendarDays,
  budget: Coins,
  election: Vote,
  announcement: Megaphone,
  payment: Package,
};

const ENTITY_LABEL = {
  event: 'Event',
  budget: 'Budget',
  election: 'Election',
  announcement: 'Announcement',
  payment: 'Payment',
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

function downloadCsv(rows) {
  const headers = ['Request ID', 'Type', 'Title', 'Status', 'Requester ID', 'Requester', 'Role', 'Position', 'Department', 'Program', 'Year Level', 'Section', 'Requested At', 'Reviewer', 'Reviewed At', 'Remarks'];
  const values = rows.map((item) => [item.id, item.entity_type, item.title, item.status, item.requester?.school_id, `${item.requester?.first_name || ''} ${item.requester?.last_name || ''}`.trim(), item.requester?.role, item.requester?.position_title, item.requester?.department, item.requester?.program, item.requester?.year_level, item.requester?.section, item.requested_at, `${item.reviewer?.first_name || ''} ${item.reviewer?.last_name || ''}`.trim(), item.reviewed_at, item.remarks]);
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
    const amount = Number(summary.allocated_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
    return `Allocation: PHP ${amount}${summary.event_title ? ` | ${summary.event_title}` : ''}`;
  }

  if (entityType === 'election') {
    return `${formatDate(summary.start_time)} - ${formatDate(summary.end_time)} | Requested status: ${summary.target_status || 'upcoming'}`;
  }

  if (entityType === 'announcement') {
    return `Audience: ${summary.target_role || 'all'} | Category: ${summary.category || 'general'} | Status: ${summary.approval_status || 'pending'}`;
  }

  if (entityType === 'payment') {
    const total = Number(summary.total_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
    return `${summary.item || 'Merchandise'} | Buyer: ${summary.buyer || 'Unknown'} | PHP ${total}${summary.payment_reference ? ` | Ref: ${summary.payment_reference}` : ''}`;
  }

  return null;
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user')) || {};
  } catch {
    return {};
  }
}

function roleLabel(role) {
  return {
    ADMIN: 'Admin',
    DEPARTMENT_HEAD: 'Department Head',
  }[role] || 'Reviewer';
}

function ReviewModal({ open, request, action, onCancel, onConfirm, busy }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (open) setRemarks('');
  }, [open]);

  if (!open || !request) return null;

  const isReject = action === 'rejected';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">
          {isReject ? 'Reject' : 'Approve'} "{request.title}"
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          {isReject
            ? 'Let the requester know what needs to change before resubmitting.'
            : 'This will update the request and notify the requester.'}
        </p>
        <div className="mt-4 space-y-1.5">
          <label className="text-[13px] font-semibold text-[#0F172A]">
            Remarks {isReject ? '' : '(optional)'}
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
            className={`h-11 rounded-lg px-5 text-sm font-bold text-white transition disabled:opacity-50 ${isReject ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0B8ED0] hover:bg-[#0878B7]'}`}
          >
            {busy ? 'Processing...' : isReject ? 'Reject' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DepartmentHeadApprovalsPage() {
  const currentUser = getStoredUser();
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
  const [modalState, setModalState] = useState({ open: false, request: null, action: null });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // The "Pending (n)" tab label always names the pending queue, even while
    // viewing "All History", so it is read from its own totals-only request
    // rather than from whichever status is currently loaded into `requests`.
    Promise.all([
      getApprovalRequests({
        status: statusFilter,
        entity_type: entityFilter === 'all' ? undefined : entityFilter,
        search: search || undefined,
        from: from || undefined,
        to: to || undefined,
        sort,
        page,
      }),
      getApprovalRequests({ status: 'pending', per_page: 1 }),
    ])
      .then(([res, pendingRes]) => {
        setRequests(unwrapList(res.data));
        setMeta(listMeta(res.data));
        setPendingTotal(listMeta(pendingRes.data).total);
      })
      .catch(() => setError('Failed to load approval requests.'))
      .finally(() => setLoading(false));
  }, [statusFilter, entityFilter, search, from, to, sort, page]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, entityFilter, search, from, to, sort]);

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
      load();
    } catch {
      setError('Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">{roleLabel(currentUser.role)}</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Approvals</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Review approval requests awaiting your role's sign-off.</p>
      </section>

      <div className="flex gap-2">
        {['pending', 'all'].map((tab) => (
          <button
            key={tab}
            onClick={() => { setStatusFilter(tab); setPage(1); }}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              statusFilter === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'border border-[#DDE7EF] bg-white text-slate-600 hover:bg-[#EEF6FB]'
            }`}
          >
            {tab === 'pending' ? `Pending${pendingTotal ? ` (${pendingTotal})` : ''}` : 'All History'}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="relative xl:col-span-2">
            <Search size={15} className="absolute left-3 top-3.5 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requester, ID, remarks..." className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]" />
          </label>
          <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
            <option value="all">All request types</option>{Object.entries(ENTITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="date" aria-label="Requested from" value={from} onChange={(event) => setFrom(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
          <input type="date" aria-label="Requested to" value={to} onChange={(event) => setTo(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
          <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">{requests.length} matching request{requests.length === 1 ? '' : 's'} · {requests.filter((item) => item.status === 'pending').length} awaiting action</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setSearch(''); setEntityFilter('all'); setFrom(''); setTo(''); setSort('newest'); }} className="h-9 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-slate-600">Reset</button>
            <button type="button" onClick={() => downloadCsv(requests)} disabled={!requests.length} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0B8ED0] px-3 text-xs font-bold text-white disabled:opacity-50"><Download size={14} /> Export CSV</button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? (
          <div className="space-y-2 p-5">
            {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="py-14 text-center">
            <Clock size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">
              {statusFilter === 'pending' ? 'Nothing waiting for review.' : 'No approval history yet.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E5EDF3]">
            {requests.map((request) => {
              const Icon = ENTITY_ICON[request.entity_type] || Clock;
              return (
                <div key={request.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[#0F172A]">{request.title}</p>
                        <span className="rounded-full border border-[#DDE7EF] bg-[#F8FBFD] px-2 py-0.5 text-[11px] font-bold text-slate-500">
                          {ENTITY_LABEL[request.entity_type] || request.entity_type}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_BADGE[request.status]}`}>
                          {request.status}
                        </span>
                      </div>
                      {summaryLine(request.entity_type, request.summary) && (
                        <p className="mt-1 text-xs text-slate-400">{summaryLine(request.entity_type, request.summary)}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-400">
                        Requested by {request.requester ? `${request.requester.first_name} ${request.requester.last_name}` : 'Unknown'} ({request.requester?.school_id || 'No ID'}) | {formatDateTime(request.requested_at)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{[request.requester?.role, request.requester?.position_title, request.requester?.program, request.requester?.year_level, request.requester?.section].filter(Boolean).join(' · ') || 'No requester profile details'}</p>
                      {request.status !== 'pending' && request.remarks && (
                        <p className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                          <span className="font-semibold">Remarks:</span> {request.remarks}
                        </p>
                      )}
                    </div>
                  </div>

                  {request.status === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => setDetails(request)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Eye size={13} /> Details</button>
                      <button
                        onClick={() => setModalState({ open: true, request, action: 'approved' })}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        <Check size={13} /> Approve
                      </button>
                      <button
                        onClick={() => setModalState({ open: true, request, action: 'rejected' })}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        <X size={13} /> Reject
                      </button>
                    </div>
                  )}
                  {request.status !== 'pending' && <button onClick={() => setDetails(request)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Eye size={13} /> Details</button>}
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
        onCancel={() => setModalState({ open: false, request: null, action: null })}
        onConfirm={handleReview}
      />

      {details && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm" onMouseDown={() => setDetails(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Request #{details.id} · {ENTITY_LABEL[details.entity_type]}</p><h3 className="mt-1 text-xl font-black text-[#0F172A]">{details.title}</h3></div><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Status', details.status], ['Required Role', details.required_role], ['Requested At', formatDateTime(details.requested_at)],
                ['Requester', `${details.requester?.first_name || ''} ${details.requester?.last_name || ''}`.trim() || '-'], ['School ID', details.requester?.school_id], ['Email', details.requester?.email],
                ['Role / Position', [details.requester?.role, details.requester?.position_title].filter(Boolean).join(' · ')], ['Department', details.requester?.department], ['Academic Profile', [details.requester?.program, details.requester?.year_level, details.requester?.section].filter(Boolean).join(' · ')],
                ['Reviewer', `${details.reviewer?.first_name || ''} ${details.reviewer?.last_name || ''}`.trim() || '-'], ['Reviewed At', formatDateTime(details.reviewed_at)], ['Entity ID', details.entity_id],
              ].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[#0F172A]">{value || '-'}</p></div>)}
            </div>
            <div className="mt-4 rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Record summary</p><p className="mt-2 text-sm text-slate-600">{summaryLine(details.entity_type, details.summary) || 'No additional summary available.'}</p></div>
            <div className="mt-3 rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Review remarks</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{details.remarks || 'No remarks recorded.'}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
