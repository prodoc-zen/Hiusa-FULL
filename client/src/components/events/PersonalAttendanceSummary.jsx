import { formatDisplayText } from '../../utils/displayText.js';
import { useEffect, useState } from 'react';
import PaginationControls from '../PaginationControls';
import { Button, EmptyState, ErrorState, SkeletonText, StatusBadge } from '../ui';
import { getPersonalAttendance } from '../../services/eventService';

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
    getPersonalAttendance({ page, per_page: 5 })
      .then((response) => { if (!cancelled) { setData(response.data); setError(''); } })
      .catch(() => { if (!cancelled) setError('Unable to load your attendance records.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, reload]);

  const summary = data?.summary;
  const pagination = data?.pagination;
  const records = data?.records || [];
  const nothingRecorded = !summary?.attended && !summary?.missed && records.length === 0;

  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-label="Personal attendance summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold text-ink">My attendance</h2><p className="mt-1 text-sm text-ink-muted">Based on recorded attendance only. Excused records are excluded from the rate.</p></div>
        <Button variant="secondary" size="sm" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Refresh</Button>
      </div>
      {loading ? <SkeletonText lines={3} className="mt-5" /> : error ? <ErrorState title="Attendance did not load" description={error} onRetry={() => { setLoading(true); setReload((value) => value + 1); }} /> : nothingRecorded ? <EmptyState title="No events recorded yet" description="Attendance appears here once an organizer checks you in to an event." className="py-4" /> : <>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {[['Events attended', summary?.attended ?? 0], ['Missed events', summary?.missed ?? 0], ['Attendance rate', summary?.rate == null ? 'Not available' : `${summary.rate}%`]].map(([label, value]) => <div key={label} className="flex gap-1.5"><dt className="text-ink-muted">{label}</dt><dd className="font-semibold tabular-nums text-ink">{value}</dd></div>)}
        </dl>
        {records.length === 0 ? null : <ul className="mt-4 divide-y divide-line-soft border-t border-line">
          {records.map((record) => <li key={record.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-ink">{formatDisplayText(record.event?.title)}</h3><p className="mt-0.5 text-xs text-ink-muted">{dateTime(record.event?.start_time)}</p></div>{record.status === 'present' ? <span className="text-xs text-ink-muted">Present</span> : <StatusBadge status={record.status} />}</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted"><span>In: {record.status === 'absent' ? 'Not recorded' : time(record.check_in_time)}</span><span>Out: {time(record.check_out_time)}</span>{record.status !== 'absent' && record.method && <span>Method: {record.method.replaceAll('_', ' ')}</span>}</div>
          </li>)}
        </ul>}
        {pagination && <PaginationControls currentPage={pagination.current_page} totalItems={pagination.total} pageSize={pagination.per_page} onPageChange={(value) => { setLoading(true); setPage(value); }} label="attendance records" />}
      </>}
    </section>
  );
}
