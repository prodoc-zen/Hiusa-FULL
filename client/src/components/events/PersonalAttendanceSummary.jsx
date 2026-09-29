import { useEffect, useState } from 'react';
import { CalendarCheck2, Clock3 } from 'lucide-react';
import PaginationControls from '../PaginationControls';
import { getPersonalAttendance } from '../../services/eventService';

const statusStyle = {
  present: 'bg-emerald-50 text-emerald-700',
  late: 'bg-amber-50 text-amber-700',
  excused: 'bg-sky-50 text-sky-700',
  absent: 'bg-red-50 text-red-700',
};

function dateTime(value) {
  return value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
}

function time(value) {
  return value ? new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : 'Not recorded';
}

export default function PersonalAttendanceSummary() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPersonalAttendance({ page })
      .then((response) => { if (!cancelled) { setData(response.data); setError(''); } })
      .catch(() => { if (!cancelled) setError('Unable to load your attendance records.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, reload]);

  const summary = data?.summary;
  const pagination = data?.pagination;

  return (
    <section className="rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm" aria-label="Personal attendance summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-bold text-[#0F172A]"><CalendarCheck2 size={19} className="text-[#0878B7]" /> My attendance</h2><p className="mt-1 text-xs text-[#64748B]">Based on recorded attendance only. Excused records are excluded from the rate.</p></div>
        <button type="button" onClick={() => { setLoading(true); setReload((value) => value + 1); }} className="min-h-10 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0878B7] hover:bg-[#F8FBFD]">Refresh</button>
      </div>
      {loading ? <p className="mt-5 text-sm text-[#64748B]" role="status">Loading attendance...</p> : error ? <p className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : <>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {[['Events attended', summary?.attended ?? 0], ['Missed events', summary?.missed ?? 0], ['Attendance rate', summary?.rate === null ? '—' : `${summary?.rate ?? 0}%`]].map(([label, value]) => <dl key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4"><dt className="text-xs font-semibold text-[#64748B]">{label}</dt><dd className="mt-1 text-2xl font-black text-[#0F172A]">{value}</dd></dl>)}
        </div>
        {(data?.records || []).length === 0 ? <p className="mt-5 rounded-lg border border-dashed border-[#DDE7EF] p-6 text-center text-sm text-[#64748B]">No attendance has been recorded for your events yet.</p> : <div className="mt-4 space-y-2">
          {data.records.map((record) => <article key={record.id} className="rounded-lg border border-[#DDE7EF] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-[#0F172A]">{record.event?.title}</h3><p className="mt-1 text-xs text-[#64748B]">{dateTime(record.event?.start_time)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusStyle[record.status] || 'bg-slate-100 text-slate-700'}`}>{record.status}</span></div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#64748B]"><span className="inline-flex items-center gap-1"><Clock3 size={13} /> In: {record.status === 'absent' ? 'Not recorded' : time(record.check_in_time)}</span><span>Out: {time(record.check_out_time)}</span>{record.status !== 'absent' && record.method && <span>Method: {record.method.replaceAll('_', ' ')}</span>}</div>
          </article>)}
        </div>}
        {pagination && <PaginationControls currentPage={pagination.current_page} totalItems={pagination.total} pageSize={pagination.per_page} onPageChange={(value) => { setLoading(true); setPage(value); }} label="attendance records" />}
      </>}
    </section>
  );
}
