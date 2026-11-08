import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, Search, UsersRound } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import PersonPicker from '../../../components/people/PersonPicker';
import { createInvoice, getStudentDebts, recordInvoicePayment, updateInvoiceStatus } from '../../../services/financeService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '../../../components/ui';

const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => value ? new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No due date';
const EMPTY_FILTERS = { search: '', status: 'all', department: '', program: '', year_level: '', sort: 'highest_debt', per_page: 10 };

// Overdue and pending clearance carry a badge; a cleared student is the default and shows nothing.
function standing(account) {
  if (account.overdue_invoice_count) return <StatusBadge status="overdue" />;
  if (account.total_debt > 0) return <StatusBadge tone="warning" label="Pending clearance" />;
  return null;
}

export default function StudentFinancialAccountsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [options, setOptions] = useState({ departments: [], programs: [], year_levels: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, per_page: 10, current_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [charge, setCharge] = useState(null);
  const [payment, setPayment] = useState(null);
  const [closing, setClosing] = useState(null);
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
    } catch (requestError) { setError(getApiErrorMessage(requestError, 'Unable to load student financial accounts.')); }
    finally { setLoading(false); }
  }, [filters.per_page, page, params]);

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);
  const filtersActive = Boolean(filters.search.trim() || filters.department || filters.program || filters.year_level || filters.status !== 'all');
  const updateFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const refreshAndReselect = async (schoolId) => { await load(); if (schoolId) { const response = await getStudentDebts({ student_id: schoolId }); setSelected(response.data?.[0] || null); } };

  const submitCharge = async (event) => {
    event.preventDefault(); setBusy(true); setFormError('');
    try { const invoice = { ...charge }; delete invoice.student; await createInvoice(invoice); const schoolId = invoice.student_id; setCharge(null); await refreshAndReselect(schoolId); setFeedback({ open: true, type: 'success', message: 'Student charge added successfully.' }); }
    catch (requestError) { setFormError(getApiErrorMessage(requestError, 'Unable to add the charge.')); }
    finally { setBusy(false); }
  };
  const submitPayment = async (event) => {
    event.preventDefault(); setBusy(true); setFormError('');
    try { const schoolId = selected?.student?.school_id; await recordInvoicePayment(payment.invoice.id, { amount: payment.amount }); setPayment(null); await refreshAndReselect(schoolId); setFeedback({ open: true, type: 'success', message: 'Payment recorded and the balance was updated.' }); }
    catch (requestError) { setFormError(getApiErrorMessage(requestError, 'Unable to record the payment.')); }
    finally { setBusy(false); }
  };
  const submitClose = async (event) => {
    event.preventDefault(); setBusy(true); setFormError('');
    try { const schoolId = selected?.student?.school_id; const waived = closing.status === 'waived'; await updateInvoiceStatus(closing.invoice.id, { status: closing.status, reason: closing.reason }); setClosing(null); await refreshAndReselect(schoolId); setFeedback({ open: true, type: 'success', message: waived ? 'Invoice waived and removed from the balance.' : 'Invoice cancelled and removed from the balance.' }); }
    catch (requestError) { setFormError(getApiErrorMessage(requestError, 'Unable to update the invoice.')); }
    finally { setBusy(false); }
  };

  const columns = [
    { key: 'student', header: 'Student', render: (account) => <div className="text-left"><p className="font-semibold text-ink">{formatDisplayText(account.student.name)}</p><p className="text-xs text-ink-muted">{account.student.school_id}</p></div> },
    { key: 'program', header: 'Program', render: (account) => <div className="text-left"><p>{account.student.program || 'Not recorded'}</p><p className="text-xs text-ink-muted">{[account.student.department, account.student.year_level, account.student.section].filter(Boolean).join(' · ') || 'Not recorded'}</p></div> },
    { key: 'invoice_debt', header: 'Invoices', align: 'right', render: (account) => <><span>{money(account.invoice_debt)}</span><span className="block text-xs text-ink-muted">{account.unpaid_invoice_count} open</span></> },
    { key: 'reserved_order_debt', header: 'Merchandise', align: 'right', render: (account) => <><span>{money(account.reserved_order_debt)}</span><span className="block text-xs text-ink-muted">{account.pending_order_count} pending</span></> },
    { key: 'total_debt', header: 'Total balance', align: 'right', render: (account) => <span className="font-semibold">{money(account.total_debt)}</span> },
    { key: 'standing', header: 'Standing', render: standing },
  ];

  const filterRow = (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="relative min-w-56 flex-1">
        <span className="sr-only">Search accounts</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-3 text-ink-muted" aria-hidden="true" />
        <Input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Name, school ID, email, course..." className="pl-9" />
      </label>
      <Select filter aria-label="Financial status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="w-52 max-w-full"><option value="all">All statuses</option><option value="owing">Has outstanding debt</option><option value="overdue">Overdue</option><option value="pending_payment">Payment pending</option><option value="cleared">Financially cleared</option></Select>
      <Select filter aria-label="Department" value={filters.department} onChange={(event) => updateFilter('department', event.target.value)} className="w-52 max-w-full"><option value="">All departments</option>{(options.departments || []).map((value) => <option key={value}>{value}</option>)}</Select>
      {filtersActive && rows.length > 0 && <button type="button" onClick={clearFilters} className="min-h-10 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear filters</button>}
    </div>
  );

  const emptyState = filtersActive ? (
    <EmptyState kind="filtered" title="No student accounts match these filters" description="Try a different search or clear the filters." onClearFilters={clearFilters} />
  ) : (
    <EmptyState
      icon={UsersRound}
      title="No student accounts yet"
      description="An account appears for each member of your organization, with what they owe and their clearance. Add members first, then use Add student charge above to bill them."
      action={<Button variant="secondary" to="/dashboard/admin/users">Add members</Button>}
    />
  );

  return <div className="space-y-6">
    <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
    <PageHeader primary={<Button leftIcon={FilePlus2} onClick={() => { setCharge({ student: null, student_id: '', description: '', amount_due: '', due_date: '' }); setFormError(''); }}>Add student charge</Button>} />

    <dl className="grid grid-cols-1 divide-y divide-line rounded-card border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {[
        { label: 'Total outstanding', value: money(summary.total_outstanding), detail: `${summary.students_owing || 0} students with balances` },
        { label: 'Overdue accounts', value: summary.students_overdue || 0, detail: 'Past at least one due date' },
        { label: 'Cleared students', value: summary.students_cleared || 0, detail: `Out of ${summary.total_students || 0} students` },
      ].map((item) => <div key={item.label} className="p-4"><dt className="text-xs font-medium text-ink-muted">{item.label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{item.value}</dd><p className="mt-1 text-xs text-ink-muted">{item.detail}</p></div>)}
    </dl>

    <section aria-label="Student accounts">
      <DataTable
        caption="Student accounts"
        columns={columns}
        rows={rows}
        rowKey={(account) => account.student.school_id}
        loading={loading}
        error={error}
        onRetry={load}
        filters={filterRow}
        emptyState={emptyState}
        actions={(account) => <Button variant="secondary" onClick={() => setSelected(account)}>View account</Button>}
        actionsHeader="Action"
        stickyHeader={false}
        pagination={<PaginationControls currentPage={meta.current_page} totalItems={meta.total} pageSize={meta.per_page} onPageChange={setPage} label="student accounts" />}
      />
    </section>

    <Drawer
      open={Boolean(selected)}
      title="Student financial account"
      description={selected ? `${selected.student.name} · ${selected.student.school_id}` : ''}
      onClose={() => setSelected(null)}
      width="max-w-2xl"
      footer={selected && <><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button><Button onClick={() => { setCharge({ student_id: selected.student.school_id, description: '', amount_due: '', due_date: '' }); setFormError(''); }}>Add charge</Button></>}
    >
      {selected && <div className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-2">{[['Department', selected.student.department], ['Course or program', selected.student.program], ['Year and section', [selected.student.year_level, selected.student.section].filter(Boolean).join(' · ')], ['Email', selected.student.email]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-ink-muted">{label}</dt><dd className="mt-0.5 break-words text-sm text-ink">{value || 'Not recorded'}</dd></div>)}</dl>
        <dl className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3">{[['Invoice balance', selected.invoice_debt], ['Pending merchandise', selected.reserved_order_debt], ['Total outstanding', selected.total_debt]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-ink-muted">{label}</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{money(value)}</dd></div>)}</dl>
        <section className="border-t border-line pt-4"><h3 className="text-sm font-semibold text-ink">Open invoices</h3>{selected.invoices?.length ? <ul className="mt-2 divide-y divide-line-soft">{selected.invoices.map((invoice) => <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-semibold text-ink">{invoice.reference} · {invoice.description}</p><p className={`mt-1 text-xs ${invoice.due_date && new Date(invoice.due_date) < new Date() ? 'font-medium text-danger-strong' : 'text-ink-muted'}`}>Due: {date(invoice.due_date)} · Paid {money(invoice.amount_paid)}</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums text-ink">{money(invoice.remaining_balance)}</p><div className="mt-2 flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => { setPayment({ invoice, amount: '' }); setFormError(''); }}>Record payment</Button>{Number(invoice.amount_paid) <= 0 && <Button size="sm" variant="secondary" aria-label={`Cancel or waive invoice ${invoice.reference}`} onClick={() => { setClosing({ invoice, status: 'cancelled', reason: '' }); setFormError(''); }}>Cancel or waive</Button>}</div></div></li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">No open invoices.</p>}</section>
        <section className="border-t border-line pt-4"><h3 className="text-sm font-semibold text-ink">Pending merchandise</h3>{selected.reserved_orders?.length ? <ul className="mt-2 divide-y divide-line-soft">{selected.reserved_orders.map((order) => <li key={order.id} className="flex justify-between gap-3 py-3"><div><p className="text-sm font-semibold text-ink">ORD-{order.id} · {formatDisplayText(order.merchandise?.name) || 'Merchandise'}</p><p className="mt-1 text-xs text-ink-muted">{order.payment_proof_url ? 'Payment proof awaiting verification' : 'Reserved and not yet paid'}</p></div><p className="text-sm font-semibold tabular-nums text-ink">{money(order.total_price)}</p></li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">No unpaid reservations.</p>}</section>
      </div>}
    </Drawer>

    <Drawer
      open={Boolean(charge)}
      title="Add student charge"
      description="Create an amount due on the student's financial account."
      onClose={() => !busy && setCharge(null)}
      footer={<><Button variant="secondary" onClick={() => setCharge(null)} disabled={busy}>Cancel</Button><Button type="submit" form="charge-form" disabled={!charge?.student_id} loading={busy}>Add charge</Button></>}
    >
      <form id="charge-form" onSubmit={submitCharge} className="space-y-4">
        <PersonPicker label="Student" scope="college" role="STUDENT" value={charge?.student ?? null} onSelect={(person) => setCharge({ ...charge, student: person, student_id: person?.school_id ?? '' })} disabled={busy} />
        <Field label="Amount due" required><Input type="number" min="0.01" step="0.01" value={charge?.amount_due || ''} onChange={(event) => setCharge({ ...charge, amount_due: event.target.value })} /></Field>
        <Field label="Description" required><Input maxLength={255} value={charge?.description || ''} onChange={(event) => setCharge({ ...charge, description: event.target.value })} placeholder="e.g. Organization fee" /></Field>
        <Field label="Due date" optional><Input type="date" value={charge?.due_date || ''} onChange={(event) => setCharge({ ...charge, due_date: event.target.value })} /></Field>
        {formError && <p role="alert" className="text-sm font-semibold text-danger-strong">{formError}</p>}
      </form>
    </Drawer>
    <Drawer
      open={Boolean(payment)}
      title="Record invoice payment"
      description={payment ? `${payment.invoice.reference} · Remaining ${money(payment.invoice.remaining_balance)}` : ''}
      onClose={() => !busy && setPayment(null)}
      footer={<><Button variant="secondary" onClick={() => setPayment(null)} disabled={busy}>Cancel</Button><Button type="submit" form="payment-form" loading={busy}>Record payment</Button></>}
    >
      <form id="payment-form" onSubmit={submitPayment} className="space-y-4">
        <Field label="Payment amount" required><Input type="number" min="0.01" max={payment?.invoice.remaining_balance} step="0.01" value={payment?.amount || ''} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></Field>
        {formError && <p role="alert" className="text-sm font-semibold text-danger-strong">{formError}</p>}
      </form>
    </Drawer>
    <Modal open={Boolean(closing)} title="Cancel or waive invoice" description={closing ? `${closing.invoice.reference} · ${closing.invoice.description} · Remaining ${money(closing.invoice.remaining_balance)}` : ''} onClose={() => !busy && setClosing(null)} footer={<><Button variant="secondary" onClick={() => setClosing(null)} disabled={busy}>Keep invoice</Button><Button type="submit" form="close-invoice-form" variant={closing?.status === 'waived' ? 'primary' : 'danger'} loading={busy}>{closing?.status === 'waived' ? 'Waive balance' : 'Cancel invoice'}</Button></>}>
      <form id="close-invoice-form" onSubmit={submitClose} className="space-y-4">
        <Field label="Action"><Select value={closing?.status || 'cancelled'} onChange={(event) => setClosing({ ...closing, status: event.target.value })}><option value="cancelled">Cancel: charged in error</option><option value="waived">Waive: student is excused</option></Select></Field>
        <Field label="Reason" required><Textarea required rows={3} maxLength={500} value={closing?.reason || ''} onChange={(event) => setClosing({ ...closing, reason: event.target.value })} placeholder="Why is this charge being removed?" /></Field>
        {closing?.invoice.order_id && <p className="rounded-control bg-amber-50 p-3 text-xs font-medium text-amber-800">This charge bills merchandise order ORD-{closing.invoice.order_id}. Removing it returns the order to pending merchandise. Cancel the order instead to remove both.</p>}
        {formError && <p role="alert" className="text-sm font-semibold text-danger-strong">{formError}</p>}
      </form>
    </Modal>
  </div>;
}
