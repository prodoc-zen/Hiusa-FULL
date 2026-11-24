import { beforeEach, describe, expect, it } from 'vitest';
import { canHandleFinance, readCanHandleFinance } from './financeAccess';

describe('canHandleFinance', () => {
  it('lets an Admin handle finance whatever the flag says', () => {
    expect(canHandleFinance({ role: 'ADMIN' })).toBe(true);
    expect(canHandleFinance({ role: 'ADMIN', can_handle_finance: false })).toBe(true);
  });

  it('lets an officer handle finance only while their position carries the switch', () => {
    expect(canHandleFinance({ role: 'SBO_OFFICER', can_handle_finance: true })).toBe(true);
    expect(canHandleFinance({ role: 'SBO_OFFICER', can_handle_finance: false })).toBe(false);
  });

  it('treats an officer stored before the flag existed as view only', () => {
    expect(canHandleFinance({ role: 'SBO_OFFICER' })).toBe(false);
    expect(canHandleFinance({ role: 'SBO_OFFICER', can_handle_finance: 'yes' })).toBe(false);
  });

  it('never opens finance writes to students, deans or office staff', () => {
    expect(canHandleFinance({ role: 'STUDENT', can_handle_finance: true })).toBe(false);
    expect(canHandleFinance({ role: 'DEPARTMENT_HEAD', can_handle_finance: true })).toBe(false);
    expect(canHandleFinance({ role: 'ADMIN', organization: { organization_type: 'COLLEGE' } })).toBe(false);
    expect(canHandleFinance(null)).toBe(false);
  });
});

describe('readCanHandleFinance', () => {
  beforeEach(() => localStorage.clear());

  it('reads the stored user', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', can_handle_finance: true }));
    expect(readCanHandleFinance()).toBe(true);
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', can_handle_finance: false }));
    expect(readCanHandleFinance()).toBe(false);
  });

  it('is false with no stored user or a broken one', () => {
    expect(readCanHandleFinance()).toBe(false);
    localStorage.setItem('user', '{broken');
    expect(readCanHandleFinance()).toBe(false);
  });
});
