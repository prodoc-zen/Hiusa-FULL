import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, ErrorState, PageHeader, SkeletonTable } from '../../../components/ui';
import { getNotifications, markAllRead, markRead } from '../../../services/notificationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getNotificationDestination } from '../../../utils/notificationLinks';
import { notificationIcon } from '../../../utils/notificationIcon';
import { notificationAppearance } from '../../../utils/notificationTone';

export default function SaoNotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLoadError('');
    try {
      const response = await getNotifications({ per_page: 100 });
      setNotifications(response.data?.data || []);
    } catch (requestError) {
      setLoadError(getApiErrorMessage(requestError, 'Unable to load SAO notifications.'));
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
      <PageHeader primary={unread > 0 ? <Button leftIcon={CheckCheck} onClick={readAll}>Mark all as read</Button> : undefined} />
      {error && <p role="alert" className="rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{error}</p>}
      <section>
        {loading ? <SkeletonTable columns={2} rows={4} /> : loadError ? <ErrorState title="Notifications could not load" description={loadError} onRetry={load} /> : notifications.length ? <div className="divide-y divide-line border-y border-line">{notifications.map((notification) => {
          const destination = getNotificationDestination(notification, 'SUPER_ADMIN');
          const Icon = notificationIcon(notification);
          return <button key={notification.id} type="button" onClick={() => openNotification(notification)} className={`flex min-h-11 w-full items-start gap-3 px-1 py-4 text-left hover:bg-subtle ${notificationAppearance(notification).row}`}><Icon size={19} className={`mt-0.5 shrink-0 ${notificationAppearance(notification).icon}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{formatDisplayText(notification.title)}</p><p className="mt-1 text-sm text-ink-muted-strong">{notification.message}</p><p className="mt-2 text-xs text-ink-muted">{new Date(notification.sent_at || notification.created_at).toLocaleString('en-PH')}</p></div>{destination && <ExternalLink size={16} className="mt-1 shrink-0 text-brand-700" />}</button>;
        })}</div> : <EmptyState kind="first-run" title="No notifications yet" description="Registrations and requests that need the SAO appear here." />}
      </section>
    </div>
  );
}
