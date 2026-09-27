// Central status -> tone/label map. Every status string rendered anywhere in the
// app (orders, payments, elections, events, tasks, approvals, budgets, financial
// reports, users, announcements, attendance) should resolve here so a badge never
// has to invent its own colors.

export const TONE_STYLES = {
  success: 'bg-success-tint text-success-strong',
  warning: 'bg-warning-tint text-warning-strong',
  danger: 'bg-danger-tint text-danger-strong',
  info: 'bg-brand-50 text-navy-800',
  neutral: 'bg-subtle text-ink-muted border border-line',
};

export const TONE_DOT = {
  success: 'bg-success-strong',
  warning: 'bg-warning-strong',
  danger: 'bg-danger-strong',
  info: 'bg-brand-600',
  neutral: 'bg-ink-soft',
};

const STATUS_MAP = {
  // Generic approval / review lifecycle (announcements, events, budgets, approval requests)
  pending: { tone: 'warning', label: 'Pending' },
  pending_approval: { tone: 'warning', label: 'Pending Approval' },
  pending_department_head: { tone: 'warning', label: 'Pending Department Head' },
  pending_sao: { tone: 'warning', label: 'Pending SAO' },
  pending_payment: { tone: 'warning', label: 'Pending Payment' },
  under_review: { tone: 'info', label: 'Under Review' },
  submitted: { tone: 'info', label: 'Submitted' },
  resubmitted: { tone: 'info', label: 'Resubmitted' },
  payment_submitted: { tone: 'info', label: 'Payment Submitted' },
  draft: { tone: 'neutral', label: 'Draft' },
  approved: { tone: 'success', label: 'Approved' },
  accepted: { tone: 'success', label: 'Accepted' },
  rejected: { tone: 'danger', label: 'Rejected' },
  returned: { tone: 'danger', label: 'Returned' },

  // Financial accountability (cash advances, collections, remittances)
  verified: { tone: 'success', label: 'Verified' },
  released: { tone: 'success', label: 'Released' },
  partially_repaid: { tone: 'warning', label: 'Partially Repaid' },
  fully_repaid: { tone: 'success', label: 'Fully Repaid' },
  owing: { tone: 'danger', label: 'Owing' },
  cleared: { tone: 'success', label: 'Cleared' },

  // Orders / merchandise / payments
  paid: { tone: 'success', label: 'Paid' },
  claimed: { tone: 'success', label: 'Claimed' },
  unclaimed: { tone: 'neutral', label: 'Unclaimed' },
  purchased: { tone: 'success', label: 'Purchased' },
  not_purchased: { tone: 'neutral', label: 'Not Purchased' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
  canceled: { tone: 'danger', label: 'Cancelled' },

  // Elections
  upcoming: { tone: 'info', label: 'Upcoming' },
  voting: { tone: 'success', label: 'Live Voting' },
  closed: { tone: 'neutral', label: 'Closed' },

  // Events / tasks
  planning: { tone: 'neutral', label: 'Planning' },
  ongoing: { tone: 'info', label: 'Ongoing' },
  completed: { tone: 'success', label: 'Completed' },
  overdue: { tone: 'danger', label: 'Overdue' },
  in_progress: { tone: 'info', label: 'In Progress' },
  open: { tone: 'info', label: 'Open' },

  // Attendance
  present: { tone: 'success', label: 'Present' },
  late: { tone: 'warning', label: 'Late' },
  excused: { tone: 'info', label: 'Excused' },
  absent: { tone: 'danger', label: 'Absent' },

  // Users / accounts / organizations
  active: { tone: 'success', label: 'Active' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  disabled: { tone: 'danger', label: 'Disabled' },

  // Announcements
  published: { tone: 'success', label: 'Published' },
  unpublished: { tone: 'neutral', label: 'Unpublished' },
  archived: { tone: 'neutral', label: 'Archived' },

  // Transactions
  income: { tone: 'success', label: 'Income' },
  expense: { tone: 'danger', label: 'Expense' },
};

function humanize(value) {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function resolveStatus(status) {
  const key = String(status ?? '').trim().toLowerCase();

  if (STATUS_MAP[key]) {
    return STATUS_MAP[key];
  }

  if (!key) {
    return { tone: 'neutral', label: 'Unknown' };
  }

  return { tone: 'neutral', label: humanize(key) };
}

export default STATUS_MAP;
