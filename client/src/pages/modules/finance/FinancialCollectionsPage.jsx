import FieldIcon from '../../../components/FieldIcon.jsx';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, Plus } from 'lucide-react';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import CashAdvancesSection from '../../../components/finance/CashAdvancesSection';
import { createCollection, getCollections, getFinancialDashboard, recordRemittance, verifyCollection } from '../../../services/financeService';
import { getApiErrorMessage } from '../../../utils/apiError';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
const inputClass = 'mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm focus:border-[#0B8ED0] focus:outline-none focus:ring-2 focus:ring-[#16C7F3]/30';

export default function FinancialCollectionsPage() {
  const [dashboard, setDashboard] = useState(null);
  const [collections, setCollections] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ source: '', amount_collected: '', expected_amount: '', notes: '' });
  const [remit, setRemit] = useState(null);
  const [remitAmount, setRemitAmount] = useState('');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardResponse, collectionsResponse] = await Promise.all([
        getFinancialDashboard(), getCollections(filter === 'all' ? {} : { status: filter }),
      ]);
      setDashboard(dashboardResponse.data);
      setCollections(collectionsResponse.data || []);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not load collections.'));
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function saveCollection(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createCollection({ ...createForm, expected_amount: createForm.expected_amount || null });
      setCreateOpen(false);
      setCreateForm({ source: '', amount_collected: '', expected_amount: '', notes: '' });
      setNotice('Collection recorded. Another admin must verify it before it appears in the ledger.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not record the collection.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(collection) {
    if (!window.confirm(`Verify ${collection.reference} for ${money(collection.amount_collected)}?`)) return;
    setBusy(true);
    try {
      await verifyCollection(collection.id);
      setNotice('Collection verified and added to the ledger.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not verify the collection.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveRemittance(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await recordRemittance(remit.id, { amount: remitAmount });
      setRemit(null);
      setRemitAmount('');
      setNotice('Remittance recorded. Ledger income remains unchanged.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not record the remittance.'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-5 pb-8">
    <div className="flex justify-end"><button type="button" onClick={() => { setError(''); setCreateOpen(true); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white"><Plus size={17} />Record collection</button></div>
    {error && !createOpen && !remit && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Retry</button></p>}
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {loading ? <p role="status" className="rounded-lg border border-[#DDE7EF] bg-white p-6 text-sm text-slate-600">Loading financial overview...</p> : dashboard && <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[['Available funds', dashboard.available_funds], ['Verified collections', dashboard.total_collections], ['Remitted', dashboard.total_remitted], ['Awaiting remittance', dashboard.unremitted_collections]].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-white p-4"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="mt-2 text-xl font-bold tabular-nums text-[#0F2F62]">{money(value)}</dd></div>)}
    </dl>}
    <section className="rounded-lg border border-[#DDE7EF] bg-white"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#DDE7EF] p-4 sm:p-5"><div><h2 className="text-base font-bold text-[#0F172A]">Collection records</h2><p className="mt-1 text-xs text-slate-600">A verified collection creates one income entry. Remittances do not create another.</p></div><label className="text-xs font-semibold text-slate-700"><FieldIcon label="Status" />Status<select value={filter} onChange={(event) => setFilter(event.target.value)} className={inputClass}><option value="all">All</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label></div>
      {!loading && !collections.length && <p className="p-8 text-center text-sm text-slate-600">No collections match this status.</p>}
      <div className="divide-y divide-[#DDE7EF]">{collections.map((collection) => <article key={collection.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold text-[#0F172A]">{collection.source}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${collection.status === 'verified' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{collection.status}</span></div><p className="mt-1 text-xs text-slate-600">{collection.reference} · {String(collection.collected_at || '').slice(0, 10)}</p>{collection.notes && <p className="mt-1 break-words text-xs text-slate-600">{collection.notes}</p>}<p className="mt-2 text-xs text-slate-600">Remitted {money(collection.total_remitted)} · Remaining {money(collection.unremitted_balance)}</p></div><div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"><strong className="w-full text-base tabular-nums text-[#0F2F62] sm:w-auto">{money(collection.amount_collected)}</strong>{collection.status === 'pending' && Number(collection.collected_by) !== Number(user.school_id) && <button type="button" disabled={busy} onClick={() => verify(collection)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[#0B8ED0] px-3 text-xs font-bold text-[#0878B7] disabled:opacity-50"><CheckCircle2 size={15} />Verify</button>}{collection.status === 'verified' && Number(collection.unremitted_balance) > 0 && <button type="button" disabled={busy} onClick={() => { setError(''); setRemit(collection); setRemitAmount(''); }} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0F2F62] disabled:opacity-50"><ArrowDownToLine size={15} />Remit</button>}</div></article>)}</div>
    </section>
    <CashAdvancesSection onLedgerChange={load} />
    {createOpen && <AccessibleOverlay label="Record collection" onClose={() => !busy && setCreateOpen(false)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><form onSubmit={saveCollection} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 sm:p-6"><h2 className="text-lg font-bold text-[#0F172A]">Record collection</h2><p className="mt-1 text-xs text-slate-600">Another admin must verify it before the ledger records income.</p>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}<div className="mt-5 grid gap-3"><label className="text-xs font-bold text-slate-700"><FieldIcon label="Source" />Source<input required maxLength={100} value={createForm.source} onChange={(event) => setCreateForm({ ...createForm, source: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-700"><FieldIcon label="Amount collected" />Amount collected<input required type="number" min="0.01" step="0.01" value={createForm.amount_collected} onChange={(event) => setCreateForm({ ...createForm, amount_collected: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-700"><FieldIcon label="Expected amount (optional)" />Expected amount (optional)<input type="number" min="0" step="0.01" value={createForm.expected_amount} onChange={(event) => setCreateForm({ ...createForm, expected_amount: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-700"><FieldIcon label="Notes" />Notes<textarea maxLength={2000} value={createForm.notes} onChange={(event) => setCreateForm({ ...createForm, notes: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-[#DDE7EF] p-3 text-sm" /></label></div><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={() => setCreateOpen(false)} className="min-h-11 rounded-lg px-4 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Record collection'}</button></div></form></AccessibleOverlay>}
    {remit && <AccessibleOverlay label="Record remittance" onClose={() => !busy && setRemit(null)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><form onSubmit={saveRemittance} className="w-full max-w-md rounded-lg bg-white p-5 sm:p-6"><h2 className="text-lg font-bold text-[#0F172A]">Record remittance</h2><p className="mt-1 text-sm text-slate-600">{remit.reference} · Available {money(remit.unremitted_balance)}</p>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}<label className="mt-5 block text-xs font-bold text-slate-700"><FieldIcon label="Amount" />Amount<input required type="number" min="0.01" max={remit.unremitted_balance} step="0.01" value={remitAmount} onChange={(event) => setRemitAmount(event.target.value)} className={inputClass} /></label><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setRemit(null)} className="min-h-11 rounded-lg px-4 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Record remittance'}</button></div></form></AccessibleOverlay>}
  </div>;
}
