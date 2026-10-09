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

  it('lists Agency overview first for the SAO and drops the folded pages', () => {
    const group = getNavForRole('SUPER_ADMIN').find((item) => item.id === 'sao-administration');
    const labels = getVisibleChildren(group, 'SUPER_ADMIN').map((child) => child.label);
    expect(labels[0]).toBe('Agency overview');
    expect(getVisibleChildren(group, 'SUPER_ADMIN')[0].path).toBe('/dashboard/super-admin/agency');
    expect(labels).toContain('Compliance');
    expect(labels).not.toContain('Received Reports');
    expect(labels).not.toContain('Event Requirements');
  });

  it('gives Department Heads an Organizations page and no voting or merchandise', () => {
    const pages = getFlatPages('DEPARTMENT_HEAD');
    expect(pages.find((page) => page.label === 'Organizations')?.path).toBe('/dashboard/department-head/organizations');
    expect(pages.some((page) => page.path.includes('cast-vote'))).toBe(false);
    expect(pages.some((page) => page.path.includes('/merchandise'))).toBe(false);
    for (const label of ['Dashboard', 'Approvals', 'Digital Ledger', 'Activity Calendar', 'Announcements Feed', 'Results']) {
      expect(pages.some((page) => page.label === label)).toBe(true);
    }
  });

  it('keeps voting and merchandise for students', () => {
    const pages = getFlatPages('STUDENT');
    expect(pages.some((page) => page.path.includes('cast-vote'))).toBe(true);
    expect(pages.some((page) => page.path.includes('order-merchandise'))).toBe(true);
  });

  it('omits the empty Department Head Governance group', () => {
    expect(getNavForRole('DEPARTMENT_HEAD').some((item) => item.id === 'governance')).toBe(false);
    expect(getFlatPages('DEPARTMENT_HEAD').some((item) => item.path === '/dashboard/compliance')).toBe(false);
  });
});
