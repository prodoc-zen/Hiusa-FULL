export function storedUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function headCollegeName(user) {
  return user?.organization?.college || null;
}

// An ADMIN profile on a college's own home organization is the dean's office staff, not an organization head.
export function isOfficeStaff(user) {
  return user?.role === 'ADMIN' && user?.organization?.organization_type === 'COLLEGE';
}

// The role the pages and routes check: the dean's office staff do everything the dean does, so they read as the
// Department Head. Only a person who isOfficeStaff() is widened; an organization's Admin stays ADMIN. The stored user
// and /api/user keep saying ADMIN, so workspace labels and the profile switcher are not affected.
export function effectiveRole(user) {
  return isOfficeStaff(user) ? 'DEPARTMENT_HEAD' : user?.role || null;
}

export function organizationLabel(user) {
  if (user?.role === 'DEPARTMENT_HEAD') return headCollegeName(user) || 'College';
  return user?.organization?.name || 'Organization';
}
