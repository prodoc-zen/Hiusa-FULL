import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api GET cache default lifetime', () => {
  let api;
  let requests;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
    vi.resetModules();
    vi.stubEnv('VITE_API_CACHE_TTL_MS', undefined);
    localStorage.clear();
    localStorage.setItem('auth_token', 'session-one');

    ({ default: api } = await import('./api'));
    requests = 0;
    api.defaults.adapter = async (config) => {
      requests += 1;
      return { data: { n: requests }, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('serves a repeated read from memory inside 5 seconds', async () => {
    await api.get('/system/colleges');
    vi.advanceTimersByTime(4_999);
    const second = await api.get('/system/colleges');

    expect(requests).toBe(1);
    expect(second.clientCache).toBe('HIT');
  });

  it('asks the server again once 5 seconds have passed, so another session\'s change shows up quickly', async () => {
    await api.get('/system/colleges');
    vi.advanceTimersByTime(5_001);
    const second = await api.get('/system/colleges');

    expect(requests).toBe(2);
    expect(second.clientCache).toBe('MISS');
  });

  it('never caches a read that passes cache: false', async () => {
    await api.get('/college/organizations', { cache: false });
    const second = await api.get('/college/organizations', { cache: false });

    expect(requests).toBe(2);
    expect(second.clientCache).toBeUndefined();
  });
});
