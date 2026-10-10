import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';

function failWith(status, data) {
  api.defaults.adapter = async (config) => {
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
      status,
      data,
      headers: {},
      config,
      statusText: '',
    });
  };
}

describe('api interceptor password change handling', () => {
  const assign = vi.fn();
  let pathname;

  beforeEach(() => {
    assign.mockClear();
    pathname = '/dashboard/student';
    vi.stubGlobal('location', {
      assign,
      get pathname() {
        return pathname;
      },
    });
    localStorage.clear();
    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', must_change_password: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a PASSWORD_CHANGE_REQUIRED refusal to the change password page and remembers the flag', async () => {
    failWith(403, { message: 'You must change your password before continuing.', error_code: 'PASSWORD_CHANGE_REQUIRED' });

    const error = await api.post('/events').catch((caught) => caught);

    expect(assign).toHaveBeenCalledWith('/change-password');
    expect(error.isPasswordChangeRequired).toBe(true);
    expect(JSON.parse(localStorage.getItem('user')).must_change_password).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('token');
  });

  it('does not redirect again when already on the change password page', async () => {
    pathname = '/change-password';
    failWith(403, { error_code: 'PASSWORD_CHANGE_REQUIRED' });

    await api.post('/events').catch(() => {});

    expect(assign).not.toHaveBeenCalled();
  });

  it('leaves every other 403 alone', async () => {
    failWith(403, { message: 'Forbidden.' });

    const error = await api.post('/events').catch((caught) => caught);

    expect(assign).not.toHaveBeenCalled();
    expect(error.isForbidden).toBe(true);
    expect(error.isPasswordChangeRequired).toBeUndefined();
  });
});
