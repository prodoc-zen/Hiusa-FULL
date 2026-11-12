export const ORG_MODULES = [
  { key: 'members', label: 'Members' },
  { key: 'events', label: 'Events' },
  { key: 'finance', label: 'Finance' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'merchandise', label: 'Merchandise' },
  { key: 'elections', label: 'Elections' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'announcements', label: 'Announcements' },
];

export const ACCESS_LEVELS = {
  ADMIN: { label: 'Organization head', tone: 'info' },
  SBO_OFFICER: { label: 'Officer', tone: 'success' },
  STUDENT: { label: 'Member', tone: 'neutral' },
};

const GRANTABLE = {
  DEPARTMENT_HEAD: ['ADMIN', 'SBO_OFFICER', 'STUDENT'],
  ADMIN: ['SBO_OFFICER', 'STUDENT'],
};

export const grantableLevels = (actorRole) => GRANTABLE[actorRole] || [];

export function modulesLabel(profile) {
  if (profile.role === 'ADMIN') return 'Everything';
  if (profile.role !== 'SBO_OFFICER') return '-';
  if (!profile.modules) return 'Everything';
  return ORG_MODULES.filter((module) => profile.modules.includes(module.key)).map((module) => module.label).join(', ');
}
