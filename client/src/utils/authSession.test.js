import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthSession, sessionHasExpired, startAuthSession } from './authSession';

describe('four-hour sign-in session', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('records the server lifetime and detects its end', () => {
    startAuthSession({ access_token: 'token', user: { school_id: 123 }, session_expires_in_seconds: 14400 });
    expect(Number(localStorage.getItem('auth_expires_at'))).toBe(Date.now() + 14400 * 1000);
    vi.advanceTimersByTime(14399 * 1000);
    expect(sessionHasExpired()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(sessionHasExpired()).toBe(true);
    clearAuthSession();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_expires_at')).toBeNull();
  });
});
