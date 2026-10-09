import { describe, expect, it } from 'vitest';
import { getFlatPages, getNavForRole } from '../components/layout/navigation';
import { dashboardRoutes, roleCanOpen } from '../test/appRoutes';
import { getBreadcrumbs, getPageMeta, hasPageMeta } from './pageMeta';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

// A route that only redirects never renders under its own path, so it has no title to show.
const renderedRoutes = dashboardRoutes().filter((route) => !route.redirect);

function concrete(path) {
  return path.replace(/:[A-Za-z]+/g, '7');
}

describe('pageMeta covers App.jsx', () => {
  it('finds the routes it is checked against', () => {
    expect(renderedRoutes.length).toBeGreaterThan(60);
  });

  it.each(renderedRoutes.map((route) => [route.path]))('has meta for %s', (path) => {
    expect(hasPageMeta(concrete(path))).toBe(true);
  });

  it('gives every page a title and a purpose of one line, 120 characters at most, with no dashes', () => {
    renderedRoutes.forEach((route) => {
      const roles = route.roles ?? ROLES;
      roles.forEach((role) => {
        const meta = getPageMeta(concrete(route.path), role);
        expect(meta.title, `${route.path} for ${role}`).toBeTruthy();
        expect(meta.purpose.length, `${route.path} for ${role}`).toBeGreaterThan(0);
        expect(meta.purpose.length, `${route.path} for ${role}`).toBeLessThanOrEqual(120);
        expect(`${meta.title}${meta.purpose}`).not.toMatch(new RegExp('[\\u2013\\u2014]'));
      });
    });
  });

  it('is silent about a path it does not know', () => {
    expect(hasPageMeta('/dashboard/not-a-page')).toBe(false);
    expect(getPageMeta('/dashboard/not-a-page', 'ADMIN').matched).toBe(false);
    expect(getBreadcrumbs('/dashboard/not-a-page', 'ADMIN')).toEqual([]);
  });
});

describe('page titles match the menu', () => {
  it.each(ROLES)('titles every sidebar page of %s with the label its menu item carries', (role) => {
    const labelByPath = new Map();
    getFlatPages(role).forEach((page) => {
      if (!page.path.includes('?') && page.section !== 'Account') labelByPath.set(page.path, page);
    });

    labelByPath.forEach((page, path) => {
      if (page.id === 'dashboard') return;
      if (!hasPageMeta(path)) return;
      const title = getPageMeta(path, role).title.toLowerCase();
      expect([page.label, ...page.aliases].some((name) => name.toLowerCase() === title) || page.label.toLowerCase() === title, `${role}: ${path} is titled "${title}" but the menu calls it "${page.label}"`).toBe(true);
    });
  });
});

describe('getPageMeta', () => {
  it('serves one path under the name each role knows it by', () => {
    expect(getPageMeta('/dashboard/events/activity-calendar', 'SBO_OFFICER').title).toBe('Calendar');
    expect(getPageMeta('/dashboard/events/activity-calendar', 'STUDENT').title).toBe('Events');
    expect(getPageMeta('/dashboard/admin/users', 'ADMIN').title).toBe('People');
    expect(getPageMeta('/dashboard/admin/users', 'SBO_OFFICER').title).toBe('Members and fingerprints');
    expect(getPageMeta('/dashboard/elections/cast-vote', 'ADMIN').group).toBe('My activity');
    expect(getPageMeta('/dashboard/elections/cast-vote', 'STUDENT').group).toBe('Voting');
    expect(getPageMeta('/dashboard/merchandise/claim-tokens', 'ADMIN').title).toBe('Claim desk');
    expect(getPageMeta('/dashboard/finance/personal-receipts', 'STUDENT').group).toBe('My payments');
  });

  it('resolves a dynamic segment, a trailing slash and a query', () => {
    expect(getPageMeta('/dashboard/super-admin/organizations/12', 'SUPER_ADMIN').title).toBe('Organization overview');
    expect(getPageMeta('/dashboard/finance/budget-allocation/', 'ADMIN').title).toBe('Budgets');
    expect(getPageMeta('/dashboard/finance/budget-allocation?record=3', 'ADMIN').title).toBe('Budgets');
  });

  it('marks the role homes', () => {
    ROLES.forEach((role) => {
      const home = getNavForRole(role)[0].path;
      expect(getPageMeta(home, role)).toMatchObject({ isHome: true, title: 'Dashboard' });
    });
  });
});

describe('getBreadcrumbs', () => {
  it('runs Home, group, page, with Home and the group linked and the page plain', () => {
    expect(getBreadcrumbs('/dashboard/finance/financial-ledger', 'ADMIN')).toEqual([
      { label: 'Home', to: '/dashboard/admin' },
      { label: 'Finance', to: '/dashboard/finance/budget-allocation' },
      { label: 'Ledger' },
    ]);
    expect(getBreadcrumbs('/dashboard/finance/financial-ledger', 'DEPARTMENT_HEAD')[1]).toEqual({ label: 'Finance', to: '/dashboard/finance/budget-allocation' });
  });

  it('leaves the group as plain text when it would link back to the page itself', () => {
    expect(getBreadcrumbs('/dashboard/finance/budget-allocation', 'ADMIN')[1].to).toBeUndefined();
    expect(getBreadcrumbs('/dashboard/events/manage-events', 'ADMIN')[1]).toEqual({ label: 'Events and tasks', to: undefined });
  });

  it('adds the parent page on a record page: Home, group, list, record', () => {
    expect(getBreadcrumbs('/dashboard/super-admin/organizations/7', 'SUPER_ADMIN')).toEqual([
      { label: 'Home', to: '/dashboard/super-admin' },
      { label: 'Organizations', to: '/dashboard/super-admin/agency' },
      { label: 'Registrations and organizations', to: '/dashboard/super-admin/organizations' },
      { label: 'Organization overview' },
    ]);
    expect(getBreadcrumbs('/dashboard/elections/manage-candidates', 'ADMIN').map((crumb) => crumb.label)).toEqual(['Home', 'Voting', 'Elections', 'Candidates']);
    expect(getBreadcrumbs('/dashboard/elections/manage-candidates', 'SBO_OFFICER').map((crumb) => crumb.label)).toEqual(['Home', 'Voting', 'Candidates']);
  });

  it('skips a group that carries the page title and a group the role has no row for', () => {
    expect(getBreadcrumbs('/dashboard/events/activity-calendar', 'STUDENT').map((crumb) => crumb.label)).toEqual(['Home', 'Events']);
    expect(getBreadcrumbs('/dashboard/events/activity-calendar', 'DEPARTMENT_HEAD').map((crumb) => crumb.label)).toEqual(['Home', 'Calendar']);
    expect(getBreadcrumbs('/dashboard/approvals', 'ADMIN').map((crumb) => crumb.label)).toEqual(['Home', 'Approvals']);
  });

  it('shows a lone Home on a role home', () => {
    expect(getBreadcrumbs('/dashboard/student', 'STUDENT')).toEqual([{ label: 'Home' }]);
  });

  it('only links to pages the role may open', () => {
    const routes = dashboardRoutes();
    renderedRoutes.forEach((route) => {
      (route.roles ?? ROLES).forEach((role) => {
        getBreadcrumbs(concrete(route.path), role).forEach((crumb) => {
          if (!crumb.to) return;
          const target = routes.find((candidate) => candidate.path === crumb.to.split('?')[0]);
          expect(target, `${role}: crumb "${crumb.label}" on ${route.path} links to ${crumb.to}`).toBeDefined();
          expect(roleCanOpen(target, role), `${role} cannot open ${crumb.to} (crumb "${crumb.label}" on ${route.path})`).toBe(true);
        });
      });
    });
  });
});
