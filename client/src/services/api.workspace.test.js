import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('api workspace headers and scoping', () => {
  let api;
  let seen;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('auth_token', 'token');
    ({ default: api } = await import('./api'));
    seen = [];
    api.defaults.adapter = async (config) => {
      seen.push(config);
      return { data: {}, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
    };
  });

  it('sends the chosen school year on every request, reads and writes alike', async () => {
    localStorage.setItem('hiusa_selected_academic_period', JSON.stringify({ id: 41, number: 2 }));

    await api.get('/events');
    await api.post('/tasks', { title: 'Plan ahead' });

    expect(seen.map((config) => config.headers.get('X-Academic-Semester'))).toEqual(['41', '41']);
  });

  it('sends no period header when none is chosen', async () => {
    await api.get('/events');

    expect(seen[0].headers.get('X-Academic-Semester')).toBeFalsy();
  });

  it('picks up a period saved under the old sessionStorage key', async () => {
    sessionStorage.setItem('hiusa_selected_academic_period', JSON.stringify({ id: 9 }));

    await api.get('/events');

    expect(seen[0].headers.get('X-Academic-Semester')).toBe('9');
  });

  it.each(['/tasks', '/orders', '/merchandise', '/attendance/summary', '/compliance/submissions', '/organizations', '/grievances', '/events', '/budgets'])(
    'scopes a Department Head read of %s to the open organization space',
    async (url) => {
      localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
      sessionStorage.setItem('hiusa_active_subaccount', JSON.stringify({ id: 12, name: 'Computing Society' }));

      await api.get(url);

      expect(seen[0].params).toEqual({ organization_id: 12 });
    },
  );

  it('leaves other reads, other roles and explicit organization filters alone', async () => {
    sessionStorage.setItem('hiusa_active_subaccount', JSON.stringify({ id: 12, name: 'Computing Society' }));
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));

    await api.get('/college/staff');
    await api.get('/tasks', { params: { organization_id: 5 } });
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    await api.get('/tasks');

    expect(seen[0].params).toBeUndefined();
    expect(seen[1].params).toEqual({ organization_id: 5 });
    expect(seen[2].params).toBeUndefined();
  });
});
