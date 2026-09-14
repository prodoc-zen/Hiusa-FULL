export function getNotificationDestination(notification, role) {
  const referenceType = String(notification?.reference_type || '').toLowerCase();

  if (referenceType === 'approval_request') {
    if (role === 'SUPER_ADMIN') return '/dashboard/super-admin/approvals';
    if (role === 'DEPARTMENT_HEAD') return '/dashboard/department-head/approvals';
    if (role === 'ADMIN') return '/dashboard/approvals';
  }

  if (referenceType === 'announcement' || referenceType.endsWith('\\announcement')) {
    return role === 'SUPER_ADMIN'
      ? '/dashboard/super-admin/announcements'
      : '/dashboard/announcements/view-announcements';
  }

  return null;
}
