import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthSession, rememberSignOutNotice, sessionHasExpired, startAuthSession, takeSignOutNotice } from './authSession';

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

describe('sign out notice', () => {
  beforeEach(() => sessionStorage.clear());

  it('hands the reason to the next page once and then forgets it', () => {
    rememberSignOutNotice('Your officer access for Computer Society ended when the new officers took over.');
    expect(takeSignOutNotice()).toBe('Your officer access for Computer Society ended when the new officers took over.');
    expect(takeSignOutNotice()).toBeNull();
  });

  it('keeps nothing when there is no reason to give', () => {
    rememberSignOutNotice(undefined);
    expect(takeSignOutNotice()).toBeNull();
  });
});
