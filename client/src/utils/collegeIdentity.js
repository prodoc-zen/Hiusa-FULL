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

export function organizationLabel(user) {
  if (user?.role === 'DEPARTMENT_HEAD') return headCollegeName(user) || 'College';
  return user?.organization?.name || 'Organization';
}
