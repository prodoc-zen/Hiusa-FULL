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

export function organizationLabel(user) {
  if (user?.role === 'DEPARTMENT_HEAD') return headCollegeName(user) || 'College';
  return user?.organization?.name || 'Organization';
}
