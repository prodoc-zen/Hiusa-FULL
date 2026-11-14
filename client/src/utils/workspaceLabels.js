import { isOfficeStaff } from './collegeIdentity';

const ROLE_WORDS = {
  ADMIN: 'Admin',
  SBO_OFFICER: 'Officer',
  DEPARTMENT_HEAD: 'Dean',
  SUPER_ADMIN: 'SAO',
};

// The plain word for what a person does in a workspace. A student profile in the college is the Student side; in an organization it is a Member.
export function workspaceRoleWord(role, organizationType) {
  if (role === 'STUDENT') return organizationType === 'STUDENT_ORGANIZATION' ? 'Member' : 'Student';
  return ROLE_WORDS[role] || role || '';
}

// The browser tab title: HIUSA, the role, and the short name of the organization the person is working in (left out when it only repeats the role).
export function workspaceTitle(user) {
  if (!user?.role) return 'HIUSA';
  const word = isOfficeStaff(user) ? 'Office staff' : workspaceRoleWord(user.role, user.organization?.organization_type);
  const name = user.organization?.acronym || user.organization?.name;
  const organization = name && name.trim().toLowerCase() !== word.toLowerCase() ? name : null;

  return organization ? `HIUSA · ${word} · ${organization}` : `HIUSA · ${word}`;
}
