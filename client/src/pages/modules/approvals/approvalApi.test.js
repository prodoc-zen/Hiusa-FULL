import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApprovalRequest, getApprovalRequests } from '../../../services/approvalService';
import { findApprovalRequest } from './approvalApi';

vi.mock('../../../services/approvalService', () => ({ getApprovalRequest: vi.fn(), getApprovalRequests: vi.fn() }));

describe('findApprovalRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the one request by id and returns its row', async () => {
    const row = { id: 77, title: 'Hidden Budget', status: 'pending' };
    vi.mocked(getApprovalRequest).mockResolvedValue({ data: row });

    await expect(findApprovalRequest('77')).resolves.toEqual(row);
    expect(getApprovalRequest).toHaveBeenCalledWith('77');
    expect(getApprovalRequests).not.toHaveBeenCalled();
  });

  it('returns null when the server says the request is not visible', async () => {
    vi.mocked(getApprovalRequest).mockRejectedValue({ response: { status: 404 } });

    await expect(findApprovalRequest(999)).resolves.toBeNull();
  });

  it('lets any other failure through so the caller can tell it from a missing request', async () => {
    const failure = { response: { status: 500 } };
    vi.mocked(getApprovalRequest).mockRejectedValue(failure);

    await expect(findApprovalRequest(5)).rejects.toBe(failure);
  });
});
