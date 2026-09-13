import { useCallback, useEffect, useMemo, useState } from 'react';
import { BanknoteArrowDown, Check, CircleDollarSign, Coins, RefreshCw, ShieldCheck, X } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import { approveCashAdvance, getCashAdvances, getCollections, verifyCollection } from '../../../services/financeService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { fetchAllPages } from '../../../services/pagination';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
const date = (value) => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not specified';

function QueueSection({ icon: Icon, title, description, rows, empty, renderRow }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
      <header className="flex items-start gap-3 border-b border-[#DDE7EF] bg-[#F8FBFD] p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]"><Icon size={19} /></span>
        <div className="min-w-0"><h3 className="font-extrabold text-[#0F172A]">{title}</h3><p className="mt-0.5 text-xs font-medium text-slate-500">{description}</p></div>
        <span className="ml-auto rounded-full bg-[#0B1831] px-2.5 py-1 text-xs font-black text-white">{rows.length}</span>
      </header>
      {rows.length ? <div className="divide-y divide-[#E5EDF3]">{rows.map(renderRow)}</div> : <p className="p-8 text-center text-sm font-medium text-slate-400">{empty}</p>}
    </section>
  );
}

function BudgetRejectionModal({ action, busy, onCancel, onConfirm }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (action?.kind === 'budget-reject') setRemarks('');
  }, [action]);

  return (
    <Modal
      open={action?.kind === 'budget-reject'}
      title="Reject budget"
      description="Explain what must change before this budget can be resubmitted."
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={<>
        <button type="button" onClick={onCancel} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">Cancel</button>
        <button type="button" onClick={() => onConfirm(remarks)} disabled={busy || !remarks.trim()} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Rejecting...' : 'Reject budget'}</button>
      </>}
    >
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Rejection reason</span>
        <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={4} placeholder="State the amount, documentation, or allocation that needs correction..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </label>
    </Modal>
  );
}

export default function SuperAdminFinancialApprovalsPage() {
  const [budgets, setBudgets] = useState([]);
  const [collections, setCollections] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [budgetResponse, collectionResponse, advanceResponse] = await Promise.all([
        fetchAllPages(
          (params) => getApprovalRequests(params).then((response) => response.data),
          { status: 'pending', entity_type: 'budget' },
        ),
        getCollections(),
        getCashAdvances(),
      ]);
      setBudgets(budgetResponse);
      setCollections((collectionResponse.data || []).filter((row) => row.status === 'pending'));
      setAdvances((advanceResponse.data || []).filter((row) => row.status === 'pending'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load financial approvals.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingTotal = budgets.length + collections.length + advances.length;
  const actionLabel = useMemo(() => action?.kind === 'budget-reject' ? 'Reject budget' : action?.kind === 'collection' ? 'Verify collection' : action?.kind === 'advance' ? 'Approve cash advance' : 'Approve budget', [action]);

  async function confirmAction(remarks = null) {
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'budget-approve') await reviewApprovalRequest(action.row.id, { status: 'approved' });
      if (action.kind === 'budget-reject') await reviewApprovalRequest(action.row.id, { status: 'rejected', remarks: remarks.trim() });
      if (action.kind === 'collection') await verifyCollection(action.row.id);
      if (action.kind === 'advance') await approveCashAdvance(action.row.id);
      setAction(null);
      setFeedback({ open: true, type: 'success', message: `${actionLabel} completed successfully.` });
      await load();
    } catch (requestError) {
      setAction(null);
      setFeedback({ open: true, type: 'error', message: getApiErrorMessage(requestError, `Unable to ${actionLabel.toLowerCase()}.`) });
    } finally {
      setBusy(false);
    }
  }

  const actionButtons = (approve, reject, approveLabel = 'Approve') => (
    <div className="flex shrink-0 gap-2">
      {reject && <button type="button" onClick={reject} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100"><X size={13} /> Reject</button>}
      <button type="button" onClick={approve} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0B8ED0] px-3 text-xs font-bold text-white hover:bg-[#0878B7]"><Check size={13} /> {approveLabel}</button>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#0B1831] text-[#16C7F3]"><ShieldCheck size={24} /></span>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Super Admin</p><h2 className="mt-1 text-2xl font-black text-[#0F172A]">Financial Approval Center</h2><p className="mt-1 text-sm font-medium text-slate-500">Final review for budget allocations, recorded collections, and cash advances.</p></div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center"><p className="text-2xl font-black text-amber-800">{loading ? '—' : pendingTotal}</p><p className="text-[10px] font-bold uppercase text-amber-700">Pending</p></div>
      </section>

      {error && <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><span>{error}</span><button type="button" onClick={load} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold"><RefreshCw size={13} /> Retry</button></div>}
      {loading ? <div className="grid gap-4 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-xl border border-[#DDE7EF] bg-white" />)}</div> : (
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <QueueSection icon={Coins} title="Budget allocations" description="Funds remain unavailable until approved." rows={budgets} empty="No budgets awaiting final approval." renderRow={(row) => <article key={row.id} className="p-4"><p className="font-bold text-[#0F172A]">{row.title}</p><p className="mt-1 text-sm font-black text-[#0B8ED0]">{money(row.summary?.allocated_amount)}</p><p className="mt-1 text-xs text-slate-500">Requested by {row.requester ? `${row.requester.first_name} ${row.requester.last_name}` : 'Unknown'} · {date(row.requested_at)}</p><div className="mt-3">{actionButtons(() => setAction({ kind: 'budget-approve', row }), () => setAction({ kind: 'budget-reject', row }))}</div></article>} />
          <QueueSection icon={CircleDollarSign} title="Collections" description="Verification posts the amount to the ledger." rows={collections} empty="No collections awaiting verification." renderRow={(row) => <article key={row.id} className="p-4"><p className="font-bold text-[#0F172A]">{row.source}</p><p className="mt-1 text-sm font-black text-[#0B8ED0]">{money(row.amount_collected)}</p><p className="mt-1 text-xs text-slate-500">{row.reference} · Collected {date(row.collected_at)}</p><div className="mt-3">{actionButtons(() => setAction({ kind: 'collection', row }), null, 'Verify')}</div></article>} />
          <QueueSection icon={BanknoteArrowDown} title="Cash advances" description="Approved requests can then be released by Admin." rows={advances} empty="No cash advances awaiting approval." renderRow={(row) => <article key={row.id} className="p-4"><p className="font-bold text-[#0F172A]">{row.purpose}</p><p className="mt-1 text-sm font-black text-[#0B8ED0]">{money(row.amount)}</p><p className="mt-1 text-xs text-slate-500">{row.reference} · Requested {date(row.created_at)}</p><div className="mt-3">{actionButtons(() => setAction({ kind: 'advance', row }))}</div></article>} />
        </div>
      )}

      <ConfirmModal open={Boolean(action) && action?.kind !== 'budget-reject'} title={actionLabel} message="Review the amount and supporting context before confirming this financial decision." recordName={action?.row?.title || action?.row?.source || action?.row?.purpose} confirmText={actionLabel} variant="primary" busy={busy} onCancel={() => !busy && setAction(null)} onConfirm={confirmAction} />
      <BudgetRejectionModal action={action} busy={busy} onCancel={() => !busy && setAction(null)} onConfirm={confirmAction} />
      <FeedbackToast feedback={feedback} onClose={() => setFeedback((current) => ({ ...current, open: false }))} />
    </div>
  );
}
