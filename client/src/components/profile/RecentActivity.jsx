import { useCallback, useEffect, useState } from 'react';
import { getMyActivity } from '../../services/profileService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/dateTime';
import { Button, Skeleton } from '../ui';

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
    <section className="rounded-card border border-line bg-surface" aria-labelledby="recent-activity-title">
      <div className="border-b border-line p-5 sm:p-6">
        <h2 id="recent-activity-title" className="text-base font-semibold text-ink">Your recent activity</h2>
        <p className="mt-1 text-sm text-ink-muted">What you did in HIUSA, newest first.</p>
      </div>

      <div className="p-5 sm:p-6">
        {status === 'loading' && items.length === 0 && (
          <div className="space-y-2" role="status" aria-label="Loading your activity">
            {[0, 1, 2].map((key) => <Skeleton key={key} className="h-12 w-full" />)}
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm font-medium text-danger-strong">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => load(meta.page + 1)}>Try again</Button>
          </div>
        )}
        {status !== 'loading' && status !== 'error' && items.length === 0 && (
          <p className="text-sm text-ink-muted">Nothing recorded yet. Registering for an event or submitting a request will show up here.</p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line-soft">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{item.action_label} <span className="font-normal text-ink-muted">in {item.module_label}</span></p>
                  {item.record_label && <p className="mt-0.5 text-xs text-ink-muted">{item.record_label}</p>}
                </div>
                <p className="text-xs tabular-nums text-ink-muted">{formatDateTime(item.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
        {status !== 'error' && items.length > 0 && meta.page < meta.lastPage && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">Showing {items.length} of {meta.total}</p>
            <Button variant="secondary" size="sm" loading={status === 'loading'} onClick={() => load(meta.page + 1)}>Show more</Button>
          </div>
        )}
      </div>
    </section>
  );
}
