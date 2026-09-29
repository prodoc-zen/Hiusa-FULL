import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { getObjectivesOverview } from './objectivesService';

vi.mock('./api', () => ({
  default: { get: vi.fn() },
}));

describe('objectivesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the objectives overview and returns the axios promise untouched', async () => {
    api.get.mockResolvedValue({ data: { scope: { type: 'organization' }, objectives: [] } });

    const result = await getObjectivesOverview();

    expect(api.get).toHaveBeenCalledWith('/objectives/overview');
    expect(result.data).toEqual({ scope: { type: 'organization' }, objectives: [] });
  });
});
