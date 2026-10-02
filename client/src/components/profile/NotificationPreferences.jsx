import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { getNotificationPreferences, updateNotificationPreferences } from '../../services/profileService';
import { getApiErrorMessage } from '../../utils/apiError';
import notify from '../../lib/notify';
import { Button } from '../ui';

const KINDS = {
  announcement: { label: 'Announcements', detail: 'New posts from your organization and the Student Affairs Office.' },
  event: { label: 'Events and reminders', detail: 'Approved events, reminders before they start, and registration updates.' },
  election: { label: 'Elections', detail: 'When voting opens and when results are out.' },
  merchandise: { label: 'Merchandise orders', detail: 'Order status, payment checks and claim reminders.' },
};

/** Which informational updates show in this person's notifications. */
export default function NotificationPreferences() {
  const [state, setState] = useState({ status: 'loading', muted: [], mutable: [] });
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      const { data } = await getNotificationPreferences();
      setState({ status: 'ready', muted: data.muted, mutable: data.mutable });
    } catch {
      setState((current) => ({ ...current, status: 'error' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(kind) {
    const previous = state.muted;
    const muted = previous.includes(kind) ? previous.filter((value) => value !== kind) : [...previous, kind];
    setState((current) => ({ ...current, muted }));
    setSaving(kind);
    try {
      const { data } = await updateNotificationPreferences(muted);
      setState((current) => ({ ...current, muted: data.muted }));
      notify.success(muted.includes(kind) ? `${KINDS[kind].label} hidden from your notifications` : `${KINDS[kind].label} will show in your notifications`);
    } catch (cause) {
      setState((current) => ({ ...current, muted: previous }));
      notify.error(getApiErrorMessage(cause, 'Your choice was not saved. Try again.'));
    } finally {
      setSaving('');
    }
  }

  return (
    <section className="rounded-lg border border-[#DDE7EF] bg-white shadow-sm" aria-labelledby="notification-preferences-title">
      <div className="flex items-start gap-3 border-b border-[#DDE7EF] p-5 sm:p-6">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
          <BellRing size={19} aria-hidden="true" />
        </div>
        <div>
          <h2 id="notification-preferences-title" className="text-base font-extrabold text-[#0F172A]">Notifications</h2>
          <p className="mt-0.5 text-xs font-medium text-[#64748B]">Choose which updates appear in your notifications. Approvals, tasks, account and payment notices always show, because someone is waiting on them.</p>
        </div>
      </div>
      <div className="p-5 sm:p-6">
        {state.status === 'loading' && <div className="h-32 animate-pulse rounded-lg bg-slate-100" role="status" aria-label="Loading notification preferences" />}
        {state.status === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm font-semibold text-[#B91C1C]">Your notification preferences could not load.</p>
            <Button variant="secondary" size="sm" onClick={load}>Try again</Button>
          </div>
        )}
        {state.status === 'ready' && (
          <ul className="divide-y divide-[#E5EDF3]">
            {state.mutable.filter((kind) => KINDS[kind]).map((kind) => (
              <li key={kind}>
                <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#0F172A]">{KINDS[kind].label}</span>
                    <span className="mt-0.5 block text-xs font-medium leading-5 text-[#64748B]">{KINDS[kind].detail}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={!state.muted.includes(kind)}
                    disabled={saving === kind}
                    onChange={() => toggle(kind)}
                    className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
