import { describe, expect, it } from 'vitest';
import { buildWorkspaces } from './useWorkspaces';

const profile = (id, role, organization, extra = {}) => ({
  id,
  role,
  account_status: 'active',
  organization: { id: id * 10, name: `Org ${id}`, is_active: true, organization_type: 'STUDENT_ORGANIZATION', ...organization },
  ...extra,
});

describe('buildWorkspaces for students and officers', () => {
  const home = profile(1, 'STUDENT', { name: 'College of Computing', organization_type: 'COLLEGE' });
  const officer = profile(2, 'SBO_OFFICER', { name: 'Computing Society' }, { position_title: 'Treasurer' });
  const head = profile(3, 'ADMIN', { name: 'Arts Guild' });

  it('lists My account first and each organization the person runs after it', () => {
    const { spaces } = buildWorkspaces({ role: 'STUDENT', profiles: [officer, head, home], activeProfileId: 1 });

    expect(spaces.map((space) => space.label)).toEqual(['My account', 'Computing Society', 'Arts Guild']);
    expect(spaces[1].detail).toBe('SBO Officer · Treasurer');
  });

  it('puts the person on My account while the student profile is active, and in the organization once they switch', () => {
    const input = { role: 'STUDENT', profiles: [home, officer] };

    expect(buildWorkspaces({ ...input, activeProfileId: 1 }).current.label).toBe('My account');
    expect(buildWorkspaces({ ...input, activeProfileId: 2 }).current.label).toBe('Computing Society');
  });

  it('shows no switcher for someone with one place to work', () => {
    expect(buildWorkspaces({ role: 'STUDENT', profiles: [home], activeProfileId: 1 }).spaces).toEqual([]);
    expect(buildWorkspaces({ role: 'ADMIN', profiles: [head], activeProfileId: 3 }).spaces).toEqual([]);
  });

  it('skips inactive profiles and organizations that are switched off', () => {
    const inactive = { ...officer, account_status: 'inactive' };
    const closed = profile(4, 'ADMIN', { name: 'Closed Org', is_active: false });
    const lockedCollege = profile(5, 'ADMIN', { name: 'Locked College Org', college_is_active: false });

    expect(buildWorkspaces({ role: 'STUDENT', profiles: [home, inactive, closed, lockedCollege], activeProfileId: 1 }).spaces).toEqual([]);
  });

  it('lets someone who leads two organizations switch between them without a student side', () => {
    const { spaces, current } = buildWorkspaces({ role: 'ADMIN', profiles: [officer, head], activeProfileId: 3 });

    expect(spaces.map((space) => space.label)).toEqual(['Computing Society', 'Arts Guild']);
    expect(current.label).toBe('Arts Guild');
  });

  it('lists a plain member profile as its own space, so a student who is also a Member can reach it', () => {
    const member = profile(6, 'STUDENT', { name: 'Chess Club' });
    const { spaces, current } = buildWorkspaces({ role: 'STUDENT', profiles: [home, member], activeProfileId: 6 });

    expect(spaces.map((space) => space.label)).toEqual(['My account', 'Chess Club · Member']);
    expect(current.label).toBe('Chess Club · Member');
    expect(buildWorkspaces({ role: 'STUDENT', profiles: [home, member], activeProfileId: 1 }).current.label).toBe('My account');
  });

  it('keeps a member profile beside officer profiles in one list', () => {
    const member = profile(6, 'STUDENT', { name: 'Chess Club' });
    const { spaces } = buildWorkspaces({ role: 'STUDENT', profiles: [home, officer, member], activeProfileId: 1 });

    expect(spaces.map((space) => space.label)).toEqual(['My account', 'Computing Society', 'Chess Club · Member']);
  });

  it('shows no switcher for a person with exactly one profile, member or not', () => {
    const member = profile(6, 'STUDENT', { name: 'Chess Club' });

    expect(buildWorkspaces({ role: 'STUDENT', profiles: [member], activeProfileId: 6 }).spaces).toEqual([]);
  });

  it('shows a switcher for two profiles that are both in organizations', () => {
    const member = profile(6, 'STUDENT', { name: 'Chess Club' });
    const { spaces, current } = buildWorkspaces({ role: 'SBO_OFFICER', profiles: [officer, member], activeProfileId: 2 });

    expect(spaces.map((space) => space.label)).toEqual(['Computing Society', 'Chess Club · Member']);
    expect(current.label).toBe('Computing Society');
  });
});

describe('buildWorkspaces for a Department Head', () => {
  const organizations = [
    { id: 11, name: 'Computing Society', members_count: 40 },
    { id: 12, name: 'Arts Guild', members_count: 12 },
  ];

  it('offers the college first and every organization after it', () => {
    const { spaces, current } = buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: organizations });

    expect(spaces.map((space) => space.label)).toEqual(['My college', 'Computing Society', 'Arts Guild']);
    expect(spaces[1].detail).toBe('40 members');
    expect(current.label).toBe('My college');
  });

  it('follows the open organization space', () => {
    const { current } = buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: organizations, activeSubAccount: { id: '12' } });

    expect(current.label).toBe('Arts Guild');
  });

  it('has nothing to switch to while the college has no organizations', () => {
    expect(buildWorkspaces({ role: 'DEPARTMENT_HEAD', collegeOrganizations: [] }).spaces).toEqual([]);
  });
});
