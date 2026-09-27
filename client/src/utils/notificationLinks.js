export function getNotificationDestination(notification, role) {
  const rawReferenceType = String(notification?.reference_type || '').toLowerCase();
  const referenceType = rawReferenceType.split('\\').pop().split('/').pop();
  const title = String(notification?.title || '').toLowerCase();

  if (referenceType === 'approval_request') {
    if (role === 'SUPER_ADMIN') return '/dashboard/super-admin/approvals';
    if (role === 'DEPARTMENT_HEAD') return '/dashboard/department-head/approvals';
    if (role === 'ADMIN') return '/dashboard/approvals';
  }

  if (referenceType === 'announcement') {
    return role === 'SUPER_ADMIN'
      ? '/dashboard/super-admin/announcements'
      : '/dashboard/announcements/view-announcements';
  }

  if (referenceType === 'financial_report_deadline') {
    return role === 'SUPER_ADMIN'
      ? '/dashboard/super-admin/financial-reports'
      : '/dashboard/finance/transaction-history';
  }

  if (referenceType === 'event') {
    return role === 'ADMIN' && title.includes('approval request')
      ? '/dashboard/events/manage-events'
      : '/dashboard/events/activity-calendar';
  }

  if (referenceType === 'budget') {
    if (role === 'SUPER_ADMIN') return '/dashboard/super-admin/approvals';
    if (role === 'ADMIN') return '/dashboard/finance/budget-allocation';
  }

  if (referenceType === 'election') {
    return role === 'ADMIN' && title.includes('approval request')
      ? '/dashboard/elections/manage-elections'
      : '/dashboard/elections/cast-vote';
  }

  if (referenceType === 'task') {
    return role === 'ADMIN'
      ? '/dashboard/tasks/task-progress'
      : '/dashboard/tasks/assigned-tasks';
  }

  if (referenceType === 'order' || referenceType === 'payment') {
    const needsReview = title.includes('review') || title.includes('awaiting') || title.includes('submitted');
    return needsReview && ['ADMIN', 'SBO_OFFICER'].includes(role)
      ? '/dashboard/merchandise/manage-orders'
      : '/dashboard/merchandise/my-orders';
  }

  if (referenceType === 'transaction') {
    return '/dashboard/finance/personal-receipts';
  }

  if (referenceType === 'financialreport' || referenceType === 'financial_report') {
    return role === 'SUPER_ADMIN'
      ? '/dashboard/super-admin/financial-reports'
      : '/dashboard/finance/transaction-history';
  }

  return null;
}
