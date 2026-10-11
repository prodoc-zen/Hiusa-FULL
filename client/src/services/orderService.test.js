import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { getOrder, getOrders } from './orderService';

vi.mock('./api', () => ({ default: { get: vi.fn() } }));

describe('orderService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads one order by id', () => {
    getOrder(42);
    expect(api.get).toHaveBeenCalledWith('/orders/42');
  });

  it('keeps listing orders with the given params', () => {
    getOrders({ page: 2 });
    expect(api.get).toHaveBeenCalledWith('/orders', { params: { page: 2 } });
  });
});
