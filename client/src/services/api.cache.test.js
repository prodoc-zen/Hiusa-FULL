import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { clearApiCache } from './api';

const adapter = api.defaults.adapter;
const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } });

describe('API cache mutation integration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'cache-integration');
    clearApiCache();
  });
  afterEach(() => { api.defaults.adapter = adapter; clearApiCache(); });

  it('invalidates GET results after a successful write', async () => {
    const network = vi.fn(async (config) => response(config, { name: config.method === 'get' ? 'User' : 'Saved' }));
    api.defaults.adapter = network;
    await api.get('/users');
    expect((await api.get('/users')).clientCache).toBe('HIT');
    await api.put('/users/1', { name: 'Changed' });
    expect((await api.get('/users')).clientCache).toBe('MISS');
    expect(network).toHaveBeenCalledTimes(3);
  });

  it('starts a fresh GET after a write while the old GET is still pending', async () => {
    let finishOld;
    let reads = 0;
    api.defaults.adapter = (config) => {
      if (config.method === 'get' && ++reads === 1) {
        return new Promise((resolve) => { finishOld = () => resolve(response(config, ['old'])); });
      }
      return Promise.resolve(response(config, ['fresh']));
    };
    const old = api.get('/users');
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    await api.delete('/users/1');
    expect((await api.get('/users')).data).toEqual(['fresh']);
    finishOld();
    await old;
    expect((await api.get('/users')).data).toEqual(['fresh']);
    expect(reads).toBe(2);
  });
});
