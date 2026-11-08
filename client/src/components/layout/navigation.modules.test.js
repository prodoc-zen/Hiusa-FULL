import { describe, expect, it } from 'vitest';
import { filterNavByModules, getFlatPages, getNavForRole, getNavLeaves, getOrgSpaceNav } from './navigation';

const labels = (items) => items.map((item) => item.label);

describe('modules narrow an officer menu', () => {
  it('leaves the menu alone when the profile has no module list', () => {
    expect(getNavForRole('SBO_OFFICER', null)).toBe(getNavForRole('SBO_OFFICER'));
    expect(getNavForRole('SBO_OFFICER', undefined)).toBe(getNavForRole('SBO_OFFICER'));
  });

  it('keeps only the groups whose module was given, and the pages every officer needs', () => {
    const nav = getNavForRole('SBO_OFFICER', ['finance']);

    expect(labels(nav)).toEqual(expect.arrayContaining(['Dashboard', 'Ask AI', 'Finance (view only)', 'Clearance signing', 'My activity']));
    expect(labels(nav)).not.toContain('Events and tasks');
    expect(labels(nav)).not.toContain('Voting');
    expect(labels(nav)).not.toContain('Store');
    expect(labels(nav)).not.toContain('Members and fingerprints');
  });

  it('drops single pages inside a group that has several', () => {
    const nav = getNavForRole('SBO_OFFICER', ['events']);
    const events = nav.find((item) => item.id === 'events-tasks');

    expect(labels(events.children)).toEqual(['Check-in', 'Calendar', 'Venue booking']);
  });

  it('removes a group once none of its pages remain, and an empty list leaves only the read-only feed', () => {
    const nav = getNavForRole('SBO_OFFICER', []);

    expect(labels(nav)).toEqual(['Dashboard', 'Ask AI', 'Updates', 'Clearance signing', 'Records', 'My activity']);
    expect(labels(nav.find((item) => item.id === 'updates').children)).toEqual(['Feed']);
  });

  it('filters the command palette the same way', () => {
    const pages = getFlatPages('SBO_OFFICER', ['tasks']).map((page) => page.label);

    expect(pages).toContain('My tasks');
    expect(pages).not.toContain('Budgets');
    expect(pages).not.toContain('Check-in');
  });

  it('never narrows other roles', () => {
    expect(getNavForRole('ADMIN', ['events'])).toBe(getNavForRole('ADMIN'));
    expect(getNavLeaves('STUDENT', [])).toEqual(getNavLeaves('STUDENT'));
  });

  it('ignores a list that is not an array', () => {
    const items = getNavForRole('SBO_OFFICER');

    expect(filterNavByModules(items, 'events')).toBe(items);
  });
});

describe('the dean organization menu', () => {
  it('has the five pages of one organization, all under its own address', () => {
    const nav = getOrgSpaceNav(12);

    expect(labels(nav)).toEqual(['Overview', 'People and access', 'Events', 'Finance', 'Documents']);
    expect(nav.map((item) => item.path)).toEqual([
      '/dashboard/department-head/org/12',
      '/dashboard/department-head/org/12?tab=people',
      '/dashboard/department-head/org/12?tab=events',
      '/dashboard/department-head/org/12?tab=finance',
      '/dashboard/department-head/org/12?tab=documents',
    ]);
  });
});
