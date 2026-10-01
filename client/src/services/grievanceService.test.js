import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { createGrievance, getGrievance, getGrievances, updateGrievanceStatus } from './grievanceService';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('grievanceService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists grievances with the documented filters', () => {
    getGrievances({ status: 'submitted', urgency: 'High' });
    expect(api.get).toHaveBeenCalledWith('/grievances', { params: { status: 'submitted', urgency: 'High' } });
  });

  it('fetches a single grievance by id', () => {
    getGrievance(7);
    expect(api.get).toHaveBeenCalledWith('/grievances/7');
  });

  it('files a grievance', () => {
    const payload = { title: 'Broken lights', description: 'The hallway lights are out.', addressed_to: 'organization', is_anonymous: true };
    createGrievance(payload);
    expect(api.post).toHaveBeenCalledWith('/grievances', payload);
  });

  it('transitions a grievance status', () => {
    updateGrievanceStatus(3, { status: 'resolved', remarks: 'Fixed.' });
    expect(api.patch).toHaveBeenCalledWith('/grievances/3/status', { status: 'resolved', remarks: 'Fixed.' });
  });
});
