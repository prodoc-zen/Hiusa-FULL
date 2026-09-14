import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getNotifications, markAllRead, markRead } from '../../../services/notificationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getNotificationDestination } from '../../../utils/notificationLinks';

export default function SaoNotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getNotifications({ per_page: 100 });
      setNotifications(response.data?.data || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load SAO notifications.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openNotification(notification) {
    setError('');
    try {
      if (!notification.is_read) {
        await markRead(notification.id);
        setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
      }
      const destination = getNotificationDestination(notification, 'SUPER_ADMIN');
      if (destination) navigate(destination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to open this notification.'));
    }
  }

  async function readAll() {
    setError('');
    try {
      await markAllRead();
      setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to mark SAO notifications as read.'));
    }
  }

  const unread = notifications.filter((notification) => !notification.is_read).length;

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-lg bg-[#0B1831] p-6 text-white sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#16C7F3]">Student Affairs Office</p><h2 className="mt-2 text-2xl font-black">Notifications</h2><p className="mt-1 text-sm text-slate-300">SAO approval activity and relevant system notices.</p></div>
        <button type="button" disabled={!unread} onClick={readAll} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white disabled:opacity-50"><CheckCheck size={17} /> Mark all read</button>
      </section>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? <div className="h-48 animate-pulse bg-slate-100" /> : notifications.length ? <div className="divide-y divide-[#E5EDF3]">{notifications.map((notification) => {
          const destination = getNotificationDestination(notification, 'SUPER_ADMIN');
          return <button key={notification.id} type="button" onClick={() => openNotification(notification)} className={`flex w-full items-start gap-3 p-4 text-left hover:bg-[#F8FBFD] ${notification.is_read ? '' : 'bg-[#EEF6FB]'}`}><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.is_read ? 'bg-slate-200' : 'bg-[#16C7F3]'}`} /><div className="min-w-0 flex-1"><p className="font-bold text-[#0F172A]">{notification.title}</p><p className="mt-1 text-sm text-slate-600">{notification.message}</p><p className="mt-2 text-xs text-slate-400">{new Date(notification.sent_at || notification.created_at).toLocaleString('en-PH')}</p></div>{destination && <ExternalLink size={16} className="mt-1 shrink-0 text-[#0B8ED0]" />}</button>;
        })}</div> : <div className="p-10 text-center"><Bell size={38} className="mx-auto text-slate-200" /><p className="mt-3 text-sm font-semibold text-slate-500">No SAO notifications yet.</p></div>}
      </section>
    </div>
  );
}
