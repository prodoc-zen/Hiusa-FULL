import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Eye, FilePlus2, Search, WalletCards } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { createInvoice, getStudentDebts, recordInvoicePayment } from '../../../services/financeService';

const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => value ? new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No due date';
const firstError = (error) => Object.values(error?.response?.data?.errors || {}).flat()[0] || error?.response?.data?.message;

function Metric({ label, value, detail, tone = 'blue', icon: Icon }) {
  const tones = { blue: 'bg-[#EEF6FB] text-[#0B8ED0]', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', green: 'bg-emerald-50 text-emerald-700' };
  return <article className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-[#0F172A]">{value}</p><p className="mt-1 text-xs font-medium text-slate-400">{detail}</p></div><span className={`grid h-10 w-10 place-items-center rounded-lg ${tones[tone]}`}><Icon size={19} /></span></div></article>;
}

export default function StudentFinancialAccountsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [options, setOptions] = useState({ departments: [], programs: [], year_levels: [] });
  const [filters, setFilters] = useState({ search: '', status: 'all', department: '', program: '', year_level: '', sort: 'highest_debt', per_page: 10 });
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, per_page: 10, current_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [charge, setCharge] = useState(null);
  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const params = useMemo(() => ({ ...filters, page }), [filters, page]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await getStudentDebts(params); const payload = response.data;
      setRows(payload.data || []); setSummary(payload.summary || {}); setOptions(payload.filter_options || {});
      setMeta({ total: payload.total || 0, per_page: payload.per_page || filters.per_page, current_page: payload.current_page || page });
    } catch (requestError) { setError(firstError(requestError) || 'Unable to load student financial accounts.'); }
    finally { setLoading(false); }
  }, [filters.per_page, page, params]);

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);
  const updateFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const clearFilters = () => { setFilters({ search: '', status: 'all', department: '', program: '', year_level: '', sort: 'highest_debt', per_page: 10 }); setPage(1); };
  const refreshAndReselect = async (schoolId) => { await load(); if (schoolId) { const response = await getStudentDebts({ student_id: schoolId }); setSelected(response.data?.[0] || null); } };

  const submitCharge = async (event) => {
    event.preventDefault(); setBusy(true); setFormError('');
    try { await createInvoice(charge); const schoolId = charge.student_id; setCharge(null); await refreshAndReselect(schoolId); setFeedback({ open: true, type: 'success', message: 'Student charge added successfully.' }); }
    catch (requestError) { setFormError(firstError(requestError) || 'Unable to add the charge.'); }
    finally { setBusy(false); }
  };
  const submitPayment = async (event) => {
    event.preventDefault(); setBusy(true); setFormError('');
    try { const schoolId = selected?.student?.school_id; await recordInvoicePayment(payment.invoice.id, { amount: payment.amount }); setPayment(null); await refreshAndReselect(schoolId); setFeedback({ open: true, type: 'success', message: 'Payment recorded and the balance was updated.' }); }
    catch (requestError) { setFormError(firstError(requestError) || 'Unable to record the payment.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
    <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Student accountability</p><h1 className="mt-1 text-2xl font-black text-[#0F172A]">Student Financial Accounts</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">Track unpaid charges, overdue balances, pending merchandise payments, and financial clearance by student.</p></div><button type="button" onClick={() => { setCharge({ student_id: '', description: '', amount_due: '', due_date: '' }); setFormError(''); }} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7]"><FilePlus2 size={16} /> Add Student Charge</button></div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Total Outstanding" value={money(summary.total_outstanding)} detail={`${summary.students_owing || 0} students with balances`} icon={WalletCards} tone="blue" />
      <Metric label="Students Owing" value={summary.students_owing || 0} detail={`${summary.students_cleared || 0} financially cleared`} icon={AlertTriangle} tone="amber" />
      <Metric label="Overdue Accounts" value={summary.students_overdue || 0} detail="Past at least one due date" icon={AlertTriangle} tone="red" />
      <Metric label="Cleared Students" value={summary.students_cleared || 0} detail={`Out of ${summary.total_students || 0} students`} icon={BadgeCheck} tone="green" />
    </section>

    <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(140px,1fr))]">
        <label className="relative"><span className="sr-only">Search accounts</span><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Name, school ID, email, course..." className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" /></label>
        <select aria-label="Financial status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="all">All statuses</option><option value="owing">Has outstanding debt</option><option value="overdue">Overdue</option><option value="pending_payment">Payment pending</option><option value="cleared">Financially cleared</option></select>
        <select aria-label="Department" value={filters.department} onChange={(event) => updateFilter('department', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All departments</option>{(options.departments || []).map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Year level" value={filters.year_level} onChange={(event) => updateFilter('year_level', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All year levels</option>{(options.year_levels || []).map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Sort accounts" value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="highest_debt">Highest debt first</option><option value="name">Student name</option><option value="recent">Recent activity</option></select>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={clearFilters} className="text-xs font-bold text-[#0B8ED0] hover:underline">Clear all filters</button><span className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 text-xs font-semibold text-slate-500">10 rows per page</span></div>
    </section>

    {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1000px] text-left"><thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Academic profile</th><th className="px-4 py-3 text-right">Invoices</th><th className="px-4 py-3 text-right">Merchandise</th><th className="px-4 py-3 text-right">Total balance</th><th className="px-4 py-3">Standing</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-[#E5EDF3]">
        {loading ? Array.from({ length: 6 }, (_, index) => <tr key={index}>{Array.from({ length: 7 }, (__, cell) => <td key={cell} className="px-4 py-4"><div className="h-4 animate-pulse rounded bg-slate-100" /></td>)}</tr>) : rows.map((account) => <tr key={account.student.school_id} className="hover:bg-[#F8FBFD]"><td className="px-4 py-3.5"><p className="text-sm font-bold text-[#0F172A]">{account.student.name}</p><p className="mt-0.5 font-mono text-xs text-slate-400">{account.student.school_id}</p></td><td className="px-4 py-3.5"><p className="text-xs font-semibold text-slate-700">{account.student.program || 'Course not recorded'}</p><p className="mt-0.5 text-xs text-slate-400">{[account.student.department, account.student.year_level, account.student.section].filter(Boolean).join(' · ') || 'Academic details not recorded'}</p></td><td className="px-4 py-3.5 text-right text-sm font-bold text-slate-700">{money(account.invoice_debt)}<p className="text-[10px] font-medium text-slate-400">{account.unpaid_invoice_count} open</p></td><td className="px-4 py-3.5 text-right text-sm font-bold text-slate-700">{money(account.reserved_order_debt)}<p className="text-[10px] font-medium text-slate-400">{account.pending_order_count} pending</p></td><td className="px-4 py-3.5 text-right text-sm font-black text-[#0F172A]">{money(account.total_debt)}</td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${account.overdue_invoice_count ? 'bg-red-50 text-red-700' : account.total_debt > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{account.overdue_invoice_count ? 'Overdue' : account.total_debt > 0 ? 'Pending clearance' : 'Cleared'}</span></td><td className="px-4 py-3.5 text-right"><button type="button" onClick={() => setSelected(account)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#B9D9E9] bg-[#EEF6FB] px-3 text-xs font-bold text-[#0878B7]"><Eye size={14} /> View account</button></td></tr>)}
      </tbody></table></div>
      <div className="divide-y divide-[#E5EDF3] md:hidden">{loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className="m-4 h-28 animate-pulse rounded-lg bg-slate-100" />) : rows.map((account) => <article key={account.student.school_id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#0F172A]">{account.student.name}</p><p className="font-mono text-xs text-slate-400">{account.student.school_id}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${account.total_debt > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{account.total_debt > 0 ? 'Pending' : 'Cleared'}</span></div><p className="mt-2 text-xs text-slate-500">{account.student.program || 'Course not recorded'} · {account.student.year_level || 'Year not recorded'}</p><div className="mt-3 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase text-slate-400">Outstanding</p><p className="text-lg font-black text-[#0F172A]">{money(account.total_debt)}</p></div><button type="button" onClick={() => setSelected(account)} className="h-9 rounded-lg bg-[#0B8ED0] px-3 text-xs font-bold text-white">View account</button></div></article>)}</div>
      {!loading && rows.length === 0 && <div className="px-5 py-12 text-center"><BadgeCheck className="mx-auto text-slate-300" size={34} /><p className="mt-3 text-sm font-bold text-slate-600">No student accounts match these filters.</p></div>}
      <PaginationControls currentPage={meta.current_page} totalItems={meta.total} pageSize={meta.per_page} onPageChange={setPage} label="student accounts" />
    </section>

    <Modal open={Boolean(selected)} title="Student Financial Account" description={selected ? `${selected.student.name} · ${selected.student.school_id}` : ''} onClose={() => setSelected(null)} maxWidth="max-w-4xl" footer={selected && <><button type="button" onClick={() => { setCharge({ student_id: selected.student.school_id, description: '', amount_due: '', due_date: '' }); setFormError(''); }} className="h-10 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-700">Add charge</button><button type="button" onClick={() => setSelected(null)} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white">Close</button></>}>
      {selected && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Department', selected.student.department], ['Course / Program', selected.student.program], ['Year & Section', [selected.student.year_level, selected.student.section].filter(Boolean).join(' · ')], ['Email', selected.student.email]].map(([label, value]) => <div key={label} className="rounded-lg bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-bold text-[#0F172A]">{value || 'Not recorded'}</p></div>)}</div><div className="grid gap-3 sm:grid-cols-3">{[['Invoice balance', selected.invoice_debt], ['Pending merchandise', selected.reserved_order_debt], ['Total outstanding', selected.total_debt]].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-[#0F172A]">{money(value)}</p></div>)}</div>
        <div><h3 className="text-sm font-black text-[#0F172A]">Open invoices</h3>{selected.invoices?.length ? <div className="mt-2 space-y-2">{selected.invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DDE7EF] p-3"><div><p className="text-sm font-bold text-[#0F172A]">{invoice.reference} · {invoice.description}</p><p className={`mt-1 text-xs ${invoice.due_date && new Date(invoice.due_date) < new Date() ? 'font-bold text-red-600' : 'text-slate-400'}`}>Due: {date(invoice.due_date)} · Paid {money(invoice.amount_paid)}</p></div><div className="text-right"><p className="text-sm font-black text-[#0F172A]">{money(invoice.remaining_balance)}</p><button type="button" onClick={() => { setPayment({ invoice, amount: '' }); setFormError(''); }} className="mt-1 text-xs font-bold text-[#0B8ED0] hover:underline">Record payment</button></div></div>)}</div> : <p className="mt-2 text-sm text-slate-400">No open invoices.</p>}</div>
        <div><h3 className="text-sm font-black text-[#0F172A]">Pending merchandise</h3>{selected.reserved_orders?.length ? <div className="mt-2 space-y-2">{selected.reserved_orders.map((order) => <div key={order.id} className="flex justify-between gap-3 rounded-lg border border-[#DDE7EF] p-3"><div><p className="text-sm font-bold text-[#0F172A]">ORD-{order.id} · {order.merchandise?.name || 'Merchandise'}</p><p className="mt-1 text-xs text-slate-400">{order.payment_proof_url ? 'Payment proof awaiting verification' : 'Reserved and not yet paid'}</p></div><p className="text-sm font-black text-[#0F172A]">{money(order.total_price)}</p></div>)}</div> : <p className="mt-2 text-sm text-slate-400">No unpaid reservations.</p>}</div>
      </div>}
    </Modal>

    <Modal open={Boolean(charge)} title="Add Student Charge" description="Create an amount due on the student's financial account." onClose={() => !busy && setCharge(null)} footer={<><button type="button" onClick={() => setCharge(null)} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold">Cancel</button><button type="submit" form="charge-form" disabled={busy} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white">{busy ? 'Saving...' : 'Add charge'}</button></>}><form id="charge-form" onSubmit={submitCharge} className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Student school ID<input type="number" required value={charge?.student_id || ''} onChange={(event) => setCharge({ ...charge, student_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label><label className="text-xs font-bold text-slate-600">Amount due<input type="number" min="0.01" step="0.01" required value={charge?.amount_due || ''} onChange={(event) => setCharge({ ...charge, amount_due: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">Description<input required maxLength={255} value={charge?.description || ''} onChange={(event) => setCharge({ ...charge, description: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" placeholder="e.g. Organization fee" /></label><label className="text-xs font-bold text-slate-600">Due date<input type="date" value={charge?.due_date || ''} onChange={(event) => setCharge({ ...charge, due_date: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label>{formError && <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700 sm:col-span-2">{formError}</p>}</form></Modal>
    <Modal open={Boolean(payment)} title="Record Invoice Payment" description={payment ? `${payment.invoice.reference} · Remaining ${money(payment.invoice.remaining_balance)}` : ''} onClose={() => !busy && setPayment(null)} footer={<><button type="button" onClick={() => setPayment(null)} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold">Cancel</button><button type="submit" form="payment-form" disabled={busy} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white">{busy ? 'Recording...' : 'Record payment'}</button></>}><form id="payment-form" onSubmit={submitPayment}><label className="text-xs font-bold text-slate-600">Payment amount<input type="number" min="0.01" max={payment?.invoice.remaining_balance} step="0.01" required value={payment?.amount || ''} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label>{formError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{formError}</p>}</form></Modal>
  </div>;
}
