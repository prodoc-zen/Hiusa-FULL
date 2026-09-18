import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Download, Eye, FileSpreadsheet, FileText } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import TableFilterBar from '../../../components/TableFilterBar';
import {
  getFinancialReport,
  getFinancialReportDeadline,
  getFinancialReports,
  getTransactionSummary,
  getTransactions,
  setFinancialReportDeadline,
} from '../../../services/financeService';
import { getSystemOrganizations } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
const date = (value) => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not set';
const statusLabel = (value) => String(value || 'draft').replaceAll('_', ' ');

function exportRows(rows, filename, title, print = false) {
  const exportableRows = rows.length ? rows : [{ Message: 'No ledger transactions were included in this report.' }];
  const headers = Object.keys(exportableRows[0]);
  const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>body{font-family:Arial;padding:24px;color:#0f172a}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #DDE7EF;padding:8px;text-align:left}th{background:#eef6fb}</style></head><body><h1>${escape(title)}</h1><table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${exportableRows.map((row) => `<tr>${headers.map((header) => `<td>${escape(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  if (print) {
    const frame = document.createElement('iframe'); Object.assign(frame.style, { position: 'fixed', width: 0, height: 0, border: 0 }); document.body.appendChild(frame); frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close(); setTimeout(() => { frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 200); return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename }); link.click(); URL.revokeObjectURL(url);
}

export default function SuperAdminFinancialReportsPage() {
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net_balance: 0 });
  const [reports, setReports] = useState([]);
  const [meta, setMeta] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [filters, setFilters] = useState({ search: '', event_search: '', type: '', from: '', to: '' });
  const [deadline, setDeadline] = useState(null);
  const [deadlineForm, setDeadlineForm] = useState({ deadline_at: '', instructions: '' });
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries({ page, organization_id: organizationId || undefined, ...filters }).filter(([, value]) => value));
      const reportParams = { per_page: 100, ...(organizationId ? { organization_id: organizationId } : {}) };
      const [tx, totals, reportResponse, deadlineResponse] = await Promise.all([
        getTransactions(params), getTransactionSummary(params), getFinancialReports(reportParams), getFinancialReportDeadline(),
      ]);
      setTransactions(tx.data.data || []); setMeta(tx.data); setSummary(totals.data); setReports(reportResponse.data.data || []); setDeadline(deadlineResponse.data);
    } catch (error) {
      setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to load SAO financial reports.') });
    } finally { setLoading(false); }
  }, [filters, organizationId]);

  useEffect(() => { getSystemOrganizations({ per_page: 100 }).then((data) => setOrganizations(data.data || [])); }, []);
  useEffect(() => { load(1); }, [load]);

  async function saveDeadline(event) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await setFinancialReportDeadline(deadlineForm); setDeadline(response.data); setDeadlineForm({ deadline_at: '', instructions: '' });
      setFeedback({ open: true, type: 'success', message: 'Deadline saved. An official announcement and Admin notifications were sent.' });
    } catch (error) { setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to set the deadline.') }); } finally { setBusy(false); }
  }

  async function openReport(report) {
    try { setDetail((await getFinancialReport(report.id)).data); } catch (error) { setFeedback({ open: true, type: 'error', message: getApiErrorMessage(error, 'Unable to open the report.') }); }
  }

  function exportReport(format) {
    const rows = (detail?.transactions || []).map((transaction) => ({ Date: String(transaction.transaction_date || '').slice(0, 10), Type: transaction.type, Category: transaction.category, Description: transaction.description, Event: transaction.event?.title || '', Amount: Number(transaction.amount || 0).toFixed(2) }));
    exportRows(rows, `financial-report-${detail.report.id}.xls`, detail.report.title, format === 'pdf');
  }

  const activeLedgerFilters = [
    filters.search.trim() && `Search: ${filters.search.trim()}`,
    organizationId && `Organization: ${organizations.find((organization) => String(organization.id) === String(organizationId))?.acronym || organizationId}`,
    filters.event_search.trim() && `Event: ${filters.event_search.trim()}`,
    filters.type && `Type: ${filters.type}`,
    filters.from && `From: ${filters.from}`,
    filters.to && `To: ${filters.to}`,
  ].filter(Boolean);

  const clearLedgerFilters = () => {
    setOrganizationId('');
    setFilters({ search: '', event_search: '', type: '', from: '', to: '' });
  };

  return <div className="space-y-5">
    <section className="rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-5 text-white sm:p-6"><p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Student Affairs Office</p><h1 className="mt-1 text-2xl font-black text-white">Financial Reports & Transactions</h1><p className="mt-1 max-w-2xl text-sm text-slate-200">University-wide, read-only financial oversight with organization filters and formal submission deadlines.</p></section>
    <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs font-bold text-slate-500">Inflows</p><p className="mt-1 text-xl font-black text-emerald-700">{money(summary.total_income)}</p></div><div><p className="text-xs font-bold text-slate-500">Outflows</p><p className="mt-1 text-xl font-black text-red-600">{money(summary.total_expense)}</p></div><div><p className="text-xs font-bold text-slate-500">Net</p><p className="mt-1 text-xl font-black text-[#0F172A]">{money(summary.net_balance)}</p></div></div></div>
      <form onSubmit={saveDeadline} className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex items-center gap-2"><CalendarClock size={18} className="text-[#0878B7]"/><h2 className="font-bold text-[#0F172A]">Submission deadline</h2></div><p className="mt-1 text-xs text-slate-500">Current: {date(deadline?.deadline_at)}</p><label className="mt-3 block text-xs font-bold text-slate-600">New deadline<input required type="datetime-local" value={deadlineForm.deadline_at} onChange={(event) => setDeadlineForm({ ...deadlineForm, deadline_at: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3" /></label><label className="mt-3 block text-xs font-bold text-slate-600">Instructions<textarea value={deadlineForm.instructions} onChange={(event) => setDeadlineForm({ ...deadlineForm, instructions: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-[#DDE7EF] p-3" /></label><button disabled={busy} className="mt-3 h-11 w-full rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : deadline ? 'Update deadline' : 'Set deadline'}</button></form>
    </section>
    <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white"><TableFilterBar searchValue={filters.search} onSearchChange={(value) => setFilters({ ...filters, search: value })} searchPlaceholder="Search transactions" activeFilters={activeLedgerFilters} onClear={clearLedgerFilters} resultCount={meta.total} resultLabel={meta.total === 1 ? 'transaction' : 'transactions'} secondaryClassName="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><select aria-label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm"><option value="">All organizations</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.acronym} - {org.name}</option>)}</select><input aria-label="Event filter" placeholder="Filter by event" value={filters.event_search} onChange={(event) => setFilters({ ...filters, event_search: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm"/><select aria-label="Transaction type" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm"><option value="">All types</option><option value="income">Income</option><option value="expense">Expense</option></select><label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm"/></label><label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm"/></label></TableFilterBar></section>
    <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white"><div className="border-b border-[#DDE7EF] p-5"><h2 className="font-bold text-[#0F172A]">Transaction history</h2></div>{loading ? <p className="p-8 text-center text-sm text-slate-500">Loading…</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[#F8FBFD] text-xs uppercase text-slate-500"><tr>{['Date','Organization','Description','Event','Type','Amount'].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-[#DDE7EF]">{transactions.map((row) => <tr key={row.id}><td className="px-4 py-3">{date(row.transaction_date)}</td><td className="px-4 py-3 font-semibold">{row.organization?.acronym}</td><td className="px-4 py-3">{row.description}</td><td className="px-4 py-3">{row.event?.title || 'Not linked'}</td><td className="px-4 py-3 capitalize">{row.type}</td><td className="px-4 py-3 font-bold">{money(row.amount)}</td></tr>)}</tbody></table></div>}<PaginationControls currentPage={meta.current_page || 1} totalItems={meta.total || 0} pageSize={meta.per_page || 10} onPageChange={(page) => load(page)} label="transactions" /></section>
    <section className="rounded-lg border border-[#DDE7EF] bg-white"><div className="border-b border-[#DDE7EF] p-5"><h2 className="font-bold text-[#0F172A]">Submitted report register</h2></div><div className="divide-y divide-[#DDE7EF]">{reports.map((report) => <article key={report.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-bold text-[#0F172A]">{report.title}</p><p className="mt-1 text-xs text-slate-500">{report.organization?.acronym} · {statusLabel(report.submission_status)} · {date(report.generated_at)}</p></div><button type="button" onClick={() => openReport(report)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold"><Eye size={14}/> View details</button></article>)}{!reports.length && <p className="p-8 text-center text-sm text-slate-500">No reports found.</p>}</div></section>
    <Modal open={Boolean(detail)} title={detail?.report?.title || 'Financial report'} description={detail?.report ? `${detail.report.organization?.name || ''} · ${statusLabel(detail.report.submission_status)}` : ''} onClose={() => setDetail(null)} maxWidth="max-w-4xl" footer={<><button type="button" onClick={() => exportReport('excel')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white"><FileSpreadsheet size={15}/>Excel</button><button type="button" onClick={() => exportReport('pdf')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold"><FileText size={15}/>PDF</button></>}>
      {detail && <div className="space-y-4"><p className="text-sm leading-6 text-slate-600">{detail.report.summary_text}</p><div className="grid gap-3 sm:grid-cols-2"><div><h3 className="text-sm font-bold">Required signatories</h3>{Object.entries(detail.report.signatories || {}).map(([role, name]) => <p key={role} className="mt-1 text-sm capitalize text-slate-600">{role.replaceAll('_',' ')}: <strong>{name}</strong></p>)}</div><div><h3 className="text-sm font-bold">Supporting documents</h3>{(detail.report.supporting_documents || []).map((doc) => <a key={doc.path} href={resolveAssetUrl(doc.url)} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 text-sm font-bold text-[#0878B7]"><Download size={14}/>{doc.name}</a>)}{!(detail.report.supporting_documents || []).length && <p className="mt-1 text-sm text-slate-500">No files attached.</p>}</div></div></div>}
    </Modal>
    <FeedbackToast feedback={feedback} onClose={() => setFeedback((value) => ({ ...value, open: false }))}/>
  </div>;
}
