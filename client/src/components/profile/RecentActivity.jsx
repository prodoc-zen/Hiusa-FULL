import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { getMyActivity } from '../../services/profileService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/dateTime';
import { Button } from '../ui';

/** The signed-in person's own recent actions, read from the audit trail. */
export default function RecentActivity() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ page: 0, lastPage: 1, total: 0 });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = useCallback(async (page) => {
    setStatus('loading');
    setError('');
    try {
      const { data } = await getMyActivity(page);
      setItems((current) => (page === 1 ? data.data : [...current, ...data.data]));
      setMeta({ page: data.current_page, lastPage: data.last_page, total: data.total });
      setStatus('ready');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Your activity could not load.'));
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  return (
    <section className="rounded-lg border border-[#DDE7EF] bg-white shadow-sm" aria-labelledby="recent-activity-title">
      <div className="flex items-start gap-3 border-b border-[#DDE7EF] p-5 sm:p-6">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
          <History size={19} aria-hidden="true" />
        </div>
        <div>
          <h2 id="recent-activity-title" className="text-base font-extrabold text-[#0F172A]">Your recent activity</h2>
          <p className="mt-0.5 text-xs font-medium text-[#64748B]">What you did in HIUSA, newest first, as recorded in the audit trail.</p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {status === 'loading' && items.length === 0 && (
          <div className="space-y-2" role="status" aria-label="Loading your activity">
            {[0, 1, 2].map((key) => <div key={key} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm font-semibold text-[#B91C1C]">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => load(meta.page + 1)}>Try again</Button>
          </div>
        )}
        {status !== 'loading' && status !== 'error' && items.length === 0 && (
          <p className="text-sm font-medium text-[#64748B]">Nothing recorded yet. Registering for an event or submitting a request will show up here.</p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-[#E5EDF3]">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#0F172A]">{item.action_label} <span className="font-medium text-[#64748B]">in {item.module_label}</span></p>
                  {item.record_label && <p className="mt-0.5 text-xs font-medium text-[#64748B]">{item.record_label}</p>}
                </div>
                <p className="text-xs font-medium tabular-nums text-[#64748B]">{formatDateTime(item.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
        {status !== 'error' && items.length > 0 && meta.page < meta.lastPage && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-[#64748B]">Showing {items.length} of {meta.total}</p>
            <Button variant="secondary" size="sm" loading={status === 'loading'} onClick={() => load(meta.page + 1)}>Show more</Button>
          </div>
        )}
      </div>
    </section>
  );
}
