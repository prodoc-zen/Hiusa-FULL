const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// What a student owes comes from the server's rule (GET /student-debts). The Statement of account and
// My clearance both print it through here, so the two screens cannot word the same debt differently.
export function debtBreakdown(debt) {
  const parts = [];
  if (Number(debt?.unpaid_invoice_count) > 0) parts.push(plural(Number(debt.unpaid_invoice_count), 'unpaid invoice'));
  if (Number(debt?.pending_order_count) > 0) parts.push(plural(Number(debt.pending_order_count), 'reserved order'));
  return parts.join(' and ');
}

export function owedSentence(debt, money) {
  if (!debt || debt.clearance_status !== 'pending_clearance') return null;
  const breakdown = debtBreakdown(debt);
  return `You owe ${money(Number(debt.total_debt) || 0)}${breakdown ? `: ${breakdown}` : ''}.`;
}

export function debtRowFrom(response) {
  const rows = Array.isArray(response?.data) ? response.data : response?.data?.data;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}
