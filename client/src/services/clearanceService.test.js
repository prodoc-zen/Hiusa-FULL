import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import {
  closeClearancePeriod,
  createClearancePeriod,
  getClearancePeriodStudents,
  getClearancePeriods,
  getClearanceSignatures,
  getMyClearances,
  syncClearancePeriod,
  updateClearancePeriod,
  updateClearanceSignature,
} from './clearanceService';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('clearanceService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists clearance periods', () => {
    getClearancePeriods({ page: 2 });
    expect(api.get).toHaveBeenCalledWith('/clearance-periods', { params: { page: 2 } });
  });

  it('opens a clearance period', () => {
    const payload = { academic_year: '2026-2027', title: 'Clearance', required_roles: ['sao'] };
    createClearancePeriod(payload);
    expect(api.post).toHaveBeenCalledWith('/clearance-periods', payload);
  });

  it('lists a period\'s students with search and pagination', () => {
    getClearancePeriodStudents(5, { q: 'santos', page: 2 });
    expect(api.get).toHaveBeenCalledWith('/clearance-periods/5/students', { params: { q: 'santos', page: 2 } });
  });

  it('fetches the caller\'s own clearances', () => {
    getMyClearances();
    expect(api.get).toHaveBeenCalledWith('/clearances/mine');
  });

  it('lists the caller\'s signing queue', () => {
    getClearanceSignatures({ status: 'pending' });
    expect(api.get).toHaveBeenCalledWith('/clearance-signatures', { params: { status: 'pending' } });
  });

  it('signs, holds or clears a hold on a signature', () => {
    updateClearanceSignature(9, { status: 'held', remarks: 'Unpaid dues.' });
    expect(api.patch).toHaveBeenCalledWith('/clearance-signatures/9', { status: 'held', remarks: 'Unpaid dues.' });
  });

  it('edits a clearance period', () => {
    updateClearancePeriod(5, { title: 'Final Clearance' });
    expect(api.patch).toHaveBeenCalledWith('/clearance-periods/5', { title: 'Final Clearance' });
  });

  it('closes a clearance period', () => {
    closeClearancePeriod(5);
    expect(api.post).toHaveBeenCalledWith('/clearance-periods/5/close');
  });

  it('adds the students who joined since a period opened', () => {
    syncClearancePeriod(5);
    expect(api.post).toHaveBeenCalledWith('/clearance-periods/5/sync');
  });
});
