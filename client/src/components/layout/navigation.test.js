import { describe, expect, it } from 'vitest';
import { getFlatPages, getNavForRole, getVisibleChildren, resolveItemPath } from './navigation';

describe('role navigation destinations', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])('has usable destinations for %s', (role) => {
    for (const item of getNavForRole(role)) {
      if (item.children) expect(getVisibleChildren(item, role).length).toBeGreaterThan(0);
      expect(resolveItemPath(item, role)).not.toBe('/dashboard');
    }
  });

  it('offers the Department Head evaluation through Governance and search', () => {
    const governance = getNavForRole('DEPARTMENT_HEAD').find((item) => item.id === 'governance');
    expect(getVisibleChildren(governance, 'DEPARTMENT_HEAD').map((item) => item.path)).toEqual(['/dashboard/evaluation']);
    expect(getFlatPages('DEPARTMENT_HEAD')).toContainEqual(expect.objectContaining({
      label: 'Evaluation', path: '/dashboard/evaluation', section: 'Governance',
    }));
    expect(getFlatPages('DEPARTMENT_HEAD').some((item) => item.path === '/dashboard/compliance')).toBe(false);
  });
});
