import { describe, expect, it } from 'vitest';
import { workspaceRoleWord, workspaceTitle } from './workspaceLabels';

describe('workspaceRoleWord', () => {
  it('names the role in plain words', () => {
    expect(workspaceRoleWord('ADMIN')).toBe('Admin');
    expect(workspaceRoleWord('SBO_OFFICER')).toBe('Officer');
    expect(workspaceRoleWord('DEPARTMENT_HEAD')).toBe('Dean');
    expect(workspaceRoleWord('SUPER_ADMIN')).toBe('SAO');
  });

  it('calls a student profile in the college Student and one in an organization Member', () => {
    expect(workspaceRoleWord('STUDENT', 'COLLEGE')).toBe('Student');
    expect(workspaceRoleWord('STUDENT', 'STUDENT_ORGANIZATION')).toBe('Member');
  });
});

describe('workspaceTitle', () => {
  it('names the workspace with the short organization name', () => {
    expect(workspaceTitle({ role: 'SBO_OFFICER', organization: { name: 'Computing Society', acronym: 'CS' } })).toBe('HIUSA · Officer · CS');
  });

  it('falls back to the full name when there is no acronym, and to the role alone with no organization', () => {
    expect(workspaceTitle({ role: 'ADMIN', organization: { name: 'Arts Guild' } })).toBe('HIUSA · Admin · Arts Guild');
    expect(workspaceTitle({ role: 'SUPER_ADMIN' })).toBe('HIUSA · SAO');
  });

  it('drops the organization when it only repeats the role word', () => {
    expect(workspaceTitle({ role: 'SUPER_ADMIN', organization: { name: 'Student Affairs Office', acronym: 'SAO' } })).toBe('HIUSA · SAO');
  });

  it('calls an admin of the college home office staff', () => {
    expect(workspaceTitle({ role: 'ADMIN', organization: { name: 'College of Arts', acronym: 'CAS', organization_type: 'COLLEGE' } })).toBe('HIUSA · Office staff · CAS');
    expect(workspaceTitle({ role: 'ADMIN', organization: { name: 'Arts Guild', organization_type: 'STUDENT_ORGANIZATION' } })).toBe('HIUSA · Admin · Arts Guild');
  });

  it('is plain HIUSA when nobody is signed in', () => {
    expect(workspaceTitle(null)).toBe('HIUSA');
  });
});
