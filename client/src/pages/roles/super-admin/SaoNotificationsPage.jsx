import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, PageHeader } from '../../../components/ui';
import { getNotifications, markAllRead, markRead } from '../../../services/notificationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getNotificationDestination } from '../../../utils/notificationLinks';
import { notificationIcon } from '../../../utils/notificationIcon';

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
      <PageHeader primary={<Button leftIcon={CheckCheck} disabled={!unread} onClick={readAll}>Mark all as read</Button>} />
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? <div className="h-48 animate-pulse bg-slate-100" /> : notifications.length ? <div className="divide-y divide-[#DDE7EF]">{notifications.map((notification) => {
          const destination = getNotificationDestination(notification, 'SUPER_ADMIN');
          const Icon = notificationIcon(notification);
          return <button key={notification.id} type="button" onClick={() => openNotification(notification)} className={`flex w-full items-start gap-3 border-l-4 p-4 text-left hover:bg-[#F8FBFD] ${notification.is_read ? 'border-transparent' : 'border-[#0B8ED0] bg-[#E6F6FD]'}`}><Icon size={19} className={`mt-0.5 shrink-0 ${notification.is_read ? 'text-slate-400' : 'text-[#0878B7]'}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-bold text-[#0F172A]">{formatDisplayText(notification.title)}</p><p className="mt-1 text-sm text-slate-600">{notification.message}</p><p className="mt-2 text-xs text-slate-500">{new Date(notification.sent_at || notification.created_at).toLocaleString('en-PH')}</p></div>{destination && <ExternalLink size={16} className="mt-1 shrink-0 text-[#0878B7]" />}</button>;
        })}</div> : <EmptyState kind="first-run" icon={Bell} title="No SAO notifications yet" description="Registrations, submissions, and requests that need the SAO are announced here as organizations send them." />}
      </section>
    </div>
  );
}
