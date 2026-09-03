import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiGetCache } from './apiCache';

describe('API GET cache', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'session-one');
  });

  it('reuses a recent JSON response without another request', async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ id: 1, title: 'President' }],
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
    const cache = createApiGetCache({ ttlMs: 60_000 });

    const first = await cache.get('/sbo-positions', {}, request);
    const second = await cache.get('/sbo-positions', {}, request);

    expect(request).toHaveBeenCalledTimes(1);
    expect(first.clientCache).toBe('MISS');
    expect(second.clientCache).toBe('HIT');
    expect(second.data).toEqual(first.data);
  });

  it('deduplicates simultaneous requests and separates query parameters', async () => {
    let resolveRequest;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const cache = createApiGetCache();
    const first = cache.get('/audit-logs', { params: { page: 1 } }, request);
    const second = cache.get('/audit-logs', { params: { page: 1 } }, request);

    resolveRequest({ data: { data: [] }, status: 200, statusText: 'OK', headers: {} });
    const [, deduplicated] = await Promise.all([first, second]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(deduplicated.clientCache).toBe('DEDUPED');

    request.mockResolvedValue({ data: { data: [] }, status: 200, statusText: 'OK', headers: {} });
    await cache.get('/audit-logs', { params: { page: 2 } }, request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('expires entries, supports explicit bypass, and clears after mutations', async () => {
    let currentTime = 1_000;
    const request = vi.fn().mockResolvedValue({ data: [], status: 200, statusText: 'OK', headers: {} });
    const cache = createApiGetCache({ ttlMs: 100, now: () => currentTime });

    await cache.get('/users', {}, request);
    currentTime += 101;
    await cache.get('/users', {}, request);
    await cache.get('/users', { cache: false }, request);
    cache.clear();
    await cache.get('/users', {}, request);

    expect(request).toHaveBeenCalledTimes(4);
  });

  it('does not reuse one authenticated session cache in another session', async () => {
    const request = vi.fn().mockResolvedValue({ data: [], status: 200, statusText: 'OK', headers: {} });
    const cache = createApiGetCache();

    await cache.get('/users', {}, request);
    localStorage.setItem('auth_token', 'session-two');
    await cache.get('/users', {}, request);

    expect(request).toHaveBeenCalledTimes(2);
  });
});
