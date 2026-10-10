export const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
};

export function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
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
    const amount = Number(summary.allocated_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Allocation: ₱${amount}${summary.event_title ? ` | ${summary.event_title}` : ''}`;
  }

  if (entityType === 'election') {
    return `${formatDate(summary.start_time)} - ${formatDate(summary.end_time)} | Requested status: ${summary.target_status || 'upcoming'}`;
  }

  if (entityType === 'announcement') {
    return `Audience: ${summary.target_role || 'all'} | Category: ${summary.category || 'general'} | Status: ${summary.approval_status || 'pending'}`;
  }

  if (entityType === 'payment') {
    const total = Number(summary.total_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${summary.item || 'Merchandise'} | Buyer: ${summary.buyer || 'Unknown'} | ₱${total}${summary.payment_reference ? ` | Ref: ${summary.payment_reference}` : ''}`;
  }

  if (entityType === 'financial_report') {
    const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const advances = Number(summary.cash_advances_released) > 0 || Number(summary.cash_advance_repayments) > 0
      ? ` | Cash advances released ${peso(summary.cash_advances_released)} | Cash advance repayments ${peso(summary.cash_advance_repayments)}`
      : '';
    return `${summary.organization?.acronym || 'Organization'} | ${formatDate(summary.period_start)} - ${formatDate(summary.period_end)} | Inflows ${peso(summary.total_income)} | Outflows ${peso(summary.total_expense)}${advances}`;
  }

  return null;
}
