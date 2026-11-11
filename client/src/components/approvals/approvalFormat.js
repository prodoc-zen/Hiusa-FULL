import { peso } from '../../lib/format';
import { roleLabel } from '../../lib/lifecycle';

// Times are shown in Manila time whatever the browser's clock says, so a request made at 3:51 AM
// in Manila does not read 7:51 PM the day before.
const MANILA = 'Asia/Manila';

export function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: MANILA });
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: MANILA });
}

export function fullName(person) {
  return person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : '';
}

export function summaryLine(entityType, summary) {
  if (!summary) return null;

  if (entityType === 'event') {
    return `${formatDate(summary.start_time)} - ${formatDate(summary.end_time)}${summary.location ? ` | ${summary.location}` : ''}`;
  }

  if (entityType === 'budget') {
    return `Allocation: ${peso(summary.allocated_amount)}${summary.event_title ? ` | ${summary.event_title}` : ''}`;
  }

  if (entityType === 'election') {
    return `Voting ${formatDateTime(summary.start_time)} to ${formatDateTime(summary.end_time)}`;
  }

  if (entityType === 'announcement') {
    // The row already carries a status badge, so the status is left off; the audience and category
    // are shown as words, not as the stored codes.
    const audience = !summary.target_role || summary.target_role === 'all' ? 'Everyone' : roleLabel(String(summary.target_role).toUpperCase()) || 'Everyone';
    const category = String(summary.category || 'general');
    return `Audience: ${audience} | Category: ${category.charAt(0).toUpperCase()}${category.slice(1)}`;
  }

  if (entityType === 'payment') {
    return `${summary.item || 'Merchandise'} | Buyer: ${summary.buyer || 'Unknown'} | ${peso(summary.total_price)}${summary.payment_reference ? ` | Ref: ${summary.payment_reference}` : ''}`;
  }

  if (entityType === 'financial_report') {
    const advances = Number(summary.cash_advances_released) > 0 || Number(summary.cash_advance_repayments) > 0
      ? ` | Cash advances released ${peso(summary.cash_advances_released)} | Cash advance repayments ${peso(summary.cash_advance_repayments)}`
      : '';
    return `${summary.organization?.acronym || 'Organization'} | ${formatDate(summary.period_start)} - ${formatDate(summary.period_end)} | Inflows ${peso(summary.total_income)} | Outflows ${peso(summary.total_expense)}${advances}`;
  }

  return null;
}
