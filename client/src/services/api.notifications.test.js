import { afterEach, describe, expect, it, vi } from 'vitest';
import api from './api';

function succeedWith(data = {}) {
  api.defaults.adapter = async (config) => ({ status: 200, data, headers: {}, config, statusText: 'OK' });
}

describe('api interceptor notification changes', () => {
  afterEach(() => {
    window.removeEventListener('hiusa-notifications-changed', listener);
    listener.mockClear();
  });

  const listener = vi.fn();

  it('tells the page a notification was marked read, so the bell can refresh', async () => {
    window.addEventListener('hiusa-notifications-changed', listener);
    succeedWith();

    await api.patch('/notifications/read-all');
    await api.patch('/notifications/7/read');

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stays quiet for other writes and for reads', async () => {
    window.addEventListener('hiusa-notifications-changed', listener);
    succeedWith();

    await api.get('/notifications');
    await api.patch('/tasks/7');
    await api.post('/notifications', { title: 'x' });

    expect(listener).not.toHaveBeenCalled();
  });
});
