import { Bell, CalendarDays, ClipboardCheck, FileText, ShoppingBag, Vote, Wallet } from 'lucide-react';

export function notificationIcon(notification) {
  const context = `${notification.reference_type || ''} ${notification.notification_type || ''} ${notification.title || ''}`.toLowerCase();
  if (/election|vote/.test(context)) return Vote;
  if (/venue|event|booking/.test(context)) return CalendarDays;
  if (/order|merchandise|claim/.test(context)) return ShoppingBag;
  if (/budget|payment|receipt|finance|transaction/.test(context)) return Wallet;
  if (/report|document/.test(context)) return FileText;
  if (/approval|request/.test(context)) return ClipboardCheck;
  return Bell;
}
