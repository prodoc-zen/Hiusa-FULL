import { useEffect, useState } from 'react';
import { Clock3, Search, ShieldCheck } from 'lucide-react';
import PaginationControls from '../../../components/PaginationControls';
import { getAuditLogs } from '../../../services/financeService';

export default function GeneralAuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({ search: '', module: '', category: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, per_page: 25, current_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await getAuditLogs({ ...filters, page, per_page: 25 }); const payload = response.data;
        if (!cancelled) { setLogs(payload.data || []); setMeta({ total: payload.total || 0, per_page: payload.per_page || 25, current_page: payload.current_page || page }); }
      } catch { if (!cancelled) setError('Unable to load the General Audit Log.'); }
      finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters, page]);

  const update = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  return <div className="space-y-5">
    <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><ShieldCheck size={21} /></span><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">System-wide history</p><h1 className="mt-1 text-2xl font-black text-[#0F172A]">General Audit Log</h1><p className="mt-1 text-sm text-slate-500">A readable, immutable timeline of who changed what across HIUSA.</p></div></div></section>
    <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(150px,220px))]"><label className="relative"><span className="sr-only">Search audit activity</span><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder="Search person, action, or record..." className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]" /></label><select aria-label="Module" value={filters.module} onChange={(event) => update('module', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All modules</option>{['users', 'orders', 'merchandise', 'invoices', 'transactions', 'budgets', 'events', 'tasks', 'collections'].map((module) => <option key={module} value={module}>{module.replace('_', ' ')}</option>)}</select><select aria-label="Action category" value={filters.category} onChange={(event) => update('category', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All actions</option>{['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'PAYMENT', 'STATUS_CHANGE'].map((category) => <option key={category}>{category}</option>)}</select><select aria-label="Sort audit logs" value={filters.sort} onChange={(event) => update('sort', event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="user">User name</option><option value="module">Module</option></select></div></section>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
      {loading ? <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100" />)}</div> : logs.length === 0 ? <div className="p-12 text-center"><Clock3 size={34} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-600">No audit activity matches these filters.</p></div> : <div className="divide-y divide-[#E5EDF3]">{logs.map((log) => <article key={log.id} className="p-4 transition hover:bg-[#F8FBFD] sm:p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#EEF6FB] px-2.5 py-1 text-[10px] font-bold uppercase text-[#0B8ED0]">{log.module_label || log.module}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600">{log.action_category}</span></div><h2 className="mt-2 text-sm font-bold leading-6 text-[#0F172A] sm:text-base">{log.description}</h2><p className="mt-1 text-xs text-slate-500">Performed by <strong className="text-slate-700">{log.actor?.name || 'System'}</strong>{log.actor?.role ? ` · ${log.actor.role.replaceAll('_', ' ')}` : ''}</p>{log.affected_user && <p className="mt-1 text-xs text-slate-400">Affected: {log.affected_user.name} · {[log.affected_user.department, log.affected_user.program, log.affected_user.year_level].filter(Boolean).join(' · ') || 'No academic details'}</p>}</div><time className="shrink-0 text-xs font-medium text-slate-400">{log.created_at ? new Date(log.created_at).toLocaleString('en-PH') : 'Unknown time'}</time></div>{log.changes?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{log.changes.slice(0, 4).map((change) => <span key={change.field} className="rounded-md border border-[#DDE7EF] bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">{change.field}: {change.to}</span>)}</div>}</article>)}</div>}
      <PaginationControls currentPage={meta.current_page} totalItems={meta.total} pageSize={meta.per_page} onPageChange={setPage} label="audit records" />
    </section>
  </div>;
}
