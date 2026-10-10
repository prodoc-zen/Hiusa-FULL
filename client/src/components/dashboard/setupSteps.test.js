import { beforeEach, describe, expect, it } from 'vitest';
import { readSetupHidden, setupDescription, shapeSetup, writeSetupHidden } from './setupSteps';

const steps = (...keys) => keys.map((key) => ({ key, label: key, detail: key, done: false, href: `/go/${key}` }));
const setup = (...keys) => ({ completed: 0, total: keys.length, steps: steps(...keys) });
const order = (role, ...keys) => shapeSetup(role, setup(...keys)).steps.map((step) => step.key);

describe('shapeSetup', () => {
  it('puts the three steps of docs/UX_FLOW.md section 7 first for each role', () => {
    expect(order('ADMIN', 'positions', 'members', 'academic', 'compliance', 'budget', 'event').slice(0, 3)).toEqual(['positions', 'members', 'event']);
    expect(order('DEPARTMENT_HEAD', 'register', 'follow', 'review')).toEqual(['register', 'follow', 'review']);
    expect(order('SUPER_ADMIN', 'academic-year', 'college-heads', 'admins', 'requirements', 'venues', 'announcement').slice(0, 3)).toEqual(['academic-year', 'college-heads', 'requirements']);
    expect(order('STUDENT', 'contact', 'fingerprint', 'event').slice(0, 3)).toEqual(['contact', 'event', 'statement']);
    expect(order('SBO_OFFICER', 'contact', 'fingerprint')).toEqual(['contact', 'fingerprint', 'tasks']);
  });

  it('keeps the server order for keys it does not know and never reorders ties', () => {
    expect(order('ADMIN', 'zeta', 'positions', 'alpha')).toEqual(['positions', 'zeta', 'alpha']);
  });

  it('leaves the server progress alone and keeps advisory links out of it', () => {
    const shaped = shapeSetup('STUDENT', { completed: 1, total: 3, steps: [{ ...steps('contact')[0], done: true, href: null }, ...steps('fingerprint', 'event')] });
    expect(shaped.completed).toBe(1);
    expect(shaped.total).toBe(3);
    const statement = shaped.steps.find((step) => step.key === 'statement');
    expect(statement).toMatchObject({ advisory: true, done: false, href: '/dashboard/finance/statement-of-account', action: 'Open statement' });
  });

  it('marks the fingerprint step as in person and labels each button', () => {
    const shaped = shapeSetup('SBO_OFFICER', setup('contact', 'fingerprint'));
    expect(shaped.steps.find((step) => step.key === 'fingerprint').inPerson).toBe(true);
    expect(shaped.steps.find((step) => step.key === 'contact').action).toBe('Add contact number');
    expect(shaped.steps.find((step) => step.key === 'tasks')).toMatchObject({ href: '/dashboard/tasks/assigned-tasks', action: 'Open My tasks' });
  });

  it('offers Edit and resubmit while a registration is returned', () => {
    const returned = shapeSetup('DEPARTMENT_HEAD', { completed: 1, total: 3, steps: [{ ...steps('register')[0], done: true, href: null }, { ...steps('follow')[0], href: '/dashboard/department-head/organizations?status=returned' }, ...steps('review')] });
    expect(returned.steps.find((step) => step.key === 'follow').action).toBe('Edit and resubmit');
    const pending = shapeSetup('DEPARTMENT_HEAD', { completed: 1, total: 3, steps: [{ ...steps('register')[0], done: true, href: null }, { ...steps('follow')[0], href: '/dashboard/department-head/organizations?status=pending' }, ...steps('review')] });
    expect(pending.steps.find((step) => step.key === 'follow').action).toBe('Open registrations');
  });

  it('returns null when the role has no checklist', () => {
    expect(shapeSetup('ADMIN', null)).toBeNull();
  });
});

describe('setupDescription', () => {
  it('names the organization for the Admin and the college for the Department Head only', () => {
    expect(setupDescription('ADMIN', { name: 'ROBOTICS CLUB' })).toContain('Set up HIUSA for');
    expect(setupDescription('DEPARTMENT_HEAD', { name: 'College of Engineering' })).toContain('Your college: College of Engineering');
    expect(setupDescription('STUDENT', { name: 'Robotics Club' })).toBeUndefined();
    expect(setupDescription('ADMIN', null)).toBeUndefined();
  });
});

describe('setup visibility', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a hidden checklist per person', () => {
    expect(readSetupHidden('1.ADMIN.3')).toBe(false);
    writeSetupHidden('1.ADMIN.3');
    expect(readSetupHidden('1.ADMIN.3')).toBe(true);
    expect(readSetupHidden('2.ADMIN.3')).toBe(false);
  });
});
