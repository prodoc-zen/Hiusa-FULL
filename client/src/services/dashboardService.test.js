import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { getBriefing } from './dashboardService';

vi.mock('./api', () => ({
  default: { get: vi.fn() },
}));

describe('dashboardService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests the role-aware briefing endpoint', () => {
    getBriefing();
    expect(api.get).toHaveBeenCalledWith('/dashboard/briefing');
  });
});
