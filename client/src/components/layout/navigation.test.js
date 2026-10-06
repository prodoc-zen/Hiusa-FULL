import { describe, expect, it } from 'vitest';
import { getFlatPages, getNavForRole, getVisibleChildren, resolveItemPath } from './navigation';

describe('role navigation destinations', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])('has usable destinations for %s', (role) => {
    for (const item of getNavForRole(role)) {
      if (item.children) expect(getVisibleChildren(item, role).length).toBeGreaterThan(0);
      expect(resolveItemPath(item, role)).not.toBe('/dashboard');
    }
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])('omits Evaluation from navigation and search for %s', (role) => {
    expect(getFlatPages(role).some((item) => item.path.includes('evaluation'))).toBe(false);
  });

  it('omits the empty Department Head Governance group', () => {
    expect(getNavForRole('DEPARTMENT_HEAD').some((item) => item.id === 'governance')).toBe(false);
    expect(getFlatPages('DEPARTMENT_HEAD').some((item) => item.path === '/dashboard/compliance')).toBe(false);
  });
});
