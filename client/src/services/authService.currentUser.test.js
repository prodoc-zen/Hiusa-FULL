import { afterEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { getCurrentUser } from './authService';

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe('getCurrentUser', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('reads the account without the short GET cache and stores what it read', async () => {
    api.get.mockResolvedValue({ data: { school_id: 5, role: 'ADMIN' } });

    const user = await getCurrentUser();

    expect(api.get).toHaveBeenCalledWith('/user', { cache: false });
    expect(user.role).toBe('ADMIN');
    expect(JSON.parse(localStorage.getItem('user'))).toEqual({ school_id: 5, role: 'ADMIN' });
  });
});
