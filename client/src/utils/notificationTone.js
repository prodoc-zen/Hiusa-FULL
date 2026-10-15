export function notificationTone(notification) {
  const context = `${notification.status || ''} ${notification.notification_type || ''} ${notification.title || ''}`.toLowerCase();
  if (/\b(cancelled|canceled|rejected|returned|failed|failure|error|alert|overdue|denied|expired|out of stock|low stock)\b/.test(context)) return 'danger';
  if (/\b(approved|endorsed|verified|completed|success|successful|paid|claimed|restored|accepted)\b/.test(context)) return 'success';
  return 'info';
}

export function notificationAppearance(notification) {
  const tone = notificationTone(notification);
  if (tone === 'danger') return { row: notification.is_read ? 'border-transparent' : 'border-red-600 bg-red-50', icon: 'text-red-700' };
  if (tone === 'success') return { row: notification.is_read ? 'border-transparent' : 'border-green-600 bg-green-50', icon: 'text-green-800' };
  return { row: notification.is_read ? 'border-transparent' : 'border-[#0B8ED0] bg-[#E6F6FD]', icon: notification.is_read ? 'text-slate-500' : 'text-[#0878B7]' };
}
