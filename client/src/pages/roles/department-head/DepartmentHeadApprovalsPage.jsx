import { useEffect, useState } from 'react';
import { CalendarDays, Check, Clock, Coins, Vote, X } from 'lucide-react';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';

const ENTITY_ICON = {
  event: CalendarDays,
  budget: Coins,
  election: Vote,
};

const ENTITY_LABEL = {
  event: 'Event',
  budget: 'Budget',
  election: 'Election',
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

function summaryLine(entityType, summary) {
  if (!summary) return null;

  if (entityType === 'event') {
    return `${formatDate(summary.start_time)} – ${formatDate(summary.end_time)}${summary.location ? ` · ${summary.location}` : ''}`;
  }

  if (entityType === 'budget') {
    const amount = Number(summary.allocated_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
    return `Allocation: ₱${amount}`;
  }

  if (entityType === 'election') {
    return `${formatDate(summary.start_time)} – ${formatDate(summary.end_time)} · Requested status: ${summary.target_status || 'upcoming'}`;
  }

  return null;
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
            : 'This will make the item live immediately.'}
        </p>
        <div className="mt-4 space-y-1.5">
          <label className="text-[13px] font-semibold text-[#0F172A]">
            Remarks {isReject ? '' : '(optional)'}
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder={isReject ? 'e.g. Budget not yet finalized.' : 'Optional note for the requester...'}
            className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
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
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [modalState, setModalState] = useState({ open: false, request: null, action: null });
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    getApprovalRequests({ status: statusFilter })
      .then((res) => setRequests(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError('Failed to load approval requests.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

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

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Department Head</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Approvals</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Review events, budgets, and elections awaiting sign-off.</p>
      </section>

      <div className="flex gap-2">
        {['pending', 'all'].map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              statusFilter === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            {tab === 'pending' ? `Pending${pendingCount ? ` (${pendingCount})` : ''}` : 'All History'}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? (
          <div className="space-y-2 p-5">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
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
                      <p className="mt-1 text-xs text-slate-400">{summaryLine(request.entity_type, request.summary)}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Requested by {request.requester ? `${request.requester.first_name} ${request.requester.last_name}` : 'Unknown'} · {formatDate(request.requested_at)}
                      </p>
                      {request.status !== 'pending' && request.remarks && (
                        <p className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                          <span className="font-semibold">Remarks:</span> {request.remarks}
                        </p>
                      )}
                    </div>
                  </div>

                  {request.status === 'pending' && (
                    <div className="flex shrink-0 gap-2">
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
                </div>
              );
            })}
          </div>
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
    </div>
  );
}
