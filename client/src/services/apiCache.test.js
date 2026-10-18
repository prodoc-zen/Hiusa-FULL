import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiGetCache } from './apiCache';

const response = (data) => ({ data, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

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

  it('does not let a GET from before a mutation repopulate or deduplicate the fresh cache', async () => {
    const old = deferred();
    const fresh = deferred();
    const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const cache = createApiGetCache();
    const beforeMutation = cache.get('/users', {}, request);
    cache.clear();
    const afterMutation = cache.get('/users', {}, request);
    old.resolve(response(['old user']));
    await beforeMutation;
    expect(cache.size()).toBe(0);
    const joined = cache.get('/users', {}, request);
    fresh.resolve(response(['new user']));
    expect((await afterMutation).data).toEqual(['new user']);
    expect((await joined).clientCache).toBe('DEDUPED');
    expect((await cache.get('/users', {}, request)).data).toEqual(['new user']);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('drops old-session responses even if the user switches back to the same token', async () => {
    const old = deferred();
    const request = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(['current']));
    const cache = createApiGetCache();
    const initial = cache.get('/users', {}, request);
    localStorage.setItem('auth_token', 'session-two');
    await cache.get('/users', {}, request);
    localStorage.setItem('auth_token', 'session-one');
    old.resolve(response(['previous session']));
    await initial;
    expect(cache.size()).toBe(0);
    expect((await cache.get('/users', {}, request)).data).toEqual(['current']);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('bounds total UTF-8 bytes and evicts the least recently used response', async () => {
    const request = vi.fn().mockResolvedValue(response('文'));
    const cache = createApiGetCache({ maxTotalBytes: 10 });
    await cache.get('/one', {}, request);
    await cache.get('/two', {}, request);
    await cache.get('/one', {}, request);
    await cache.get('/three', {}, request);
    expect(cache.size()).toBe(2);
    expect((await cache.get('/one', {}, request)).clientCache).toBe('HIT');
    expect((await cache.get('/two', {}, request)).clientCache).toBe('MISS');
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('keeps cache snapshots isolated from consumer mutation', async () => {
    const request = vi.fn().mockResolvedValue(response([{ name: 'Original' }]));
    const cache = createApiGetCache();
    const first = await cache.get('/users', {}, request);
    first.data[0].name = 'Edited';
    expect((await cache.get('/users', {}, request)).data[0].name).toBe('Original');
  });

  it('keeps cancellation and binary downloads independent', async () => {
    const download = response(new Blob(['file']));
    const request = vi.fn().mockResolvedValue(download);
    const cache = createApiGetCache();
    const config = { signal: new AbortController().signal };
    await Promise.all([cache.get('/users', config, request), cache.get('/users', {}, request)]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await cache.get('/download', { responseType: 'blob' }, request)).toBe(download);
    expect(cache.size()).toBe(0);
  });

  it('does not store errors or server no-store responses', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ...response([]), headers: { 'cache-control': 'private, no-store' } });
    const cache = createApiGetCache();
    await expect(cache.get('/users', {}, request)).rejects.toThrow('offline');
    await cache.get('/users', {}, request);
    await cache.get('/users', {}, request);
    expect(request).toHaveBeenCalledTimes(3);
    expect(cache.size()).toBe(0);
  });

  it('supports shorter lifetimes and separates origins and explicit authorization', async () => {
    let time = 0;
    const request = vi.fn().mockResolvedValue(response([]));
    const cache = createApiGetCache({ now: () => time });
    await cache.get('/users', { cacheTtlMs: 10 }, request);
    time = 11;
    expect((await cache.get('/users', { cacheTtlMs: 10 }, request)).clientCache).toBe('MISS');
    await cache.get('/users', { baseURL: '/other-api' }, request);
    await cache.get('/users', { headers: { Authorization: 'Bearer other-profile' } }, request);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('separates URLSearchParams and Date query values', async () => {
    const request = vi.fn().mockResolvedValue(response([]));
    const cache = createApiGetCache();
    await cache.get('/requirements', { params: new URLSearchParams('page=1') }, request);
    await cache.get('/requirements', { params: new URLSearchParams('page=2') }, request);
    await cache.get('/requirements', { params: { since: new Date('2026-10-01') } }, request);
    await cache.get('/requirements', { params: { since: new Date('2026-10-02') } }, request);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('evicts a stale entry when explicitly refreshing without discarding unrelated entries', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(['old']))
      .mockResolvedValueOnce(response(['other'])).mockResolvedValue(response(['fresh']));
    const cache = createApiGetCache();
    await cache.get('/requirements', {}, request);
    await cache.get('/other', {}, request);
    await cache.get('/requirements', { cache: false }, request);
    expect((await cache.get('/requirements', {}, request)).data).toEqual(['fresh']);
    expect((await cache.get('/other', {}, request)).clientCache).toBe('HIT');
  });

  it('does not let an older in-flight request undo an explicit refresh', async () => {
    const old = deferred();
    const request = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(['fresh']));
    const cache = createApiGetCache();
    const beforeRefresh = cache.get('/requirements', {}, request);
    await cache.get('/requirements', { cache: false }, request);
    old.resolve(response(['old']));
    await beforeRefresh;
    expect((await cache.get('/requirements', {}, request)).data).toEqual(['fresh']);
  });

  it('keeps response headers isolated from consumer mutation', async () => {
    const request = vi.fn().mockResolvedValue(response([]));
    const cache = createApiGetCache();
    const first = await cache.get('/requirements', {}, request);
    first.headers['content-type'] = 'text/html';
    expect((await cache.get('/requirements', {}, request)).headers['content-type']).toBe('application/json');
  });
});
