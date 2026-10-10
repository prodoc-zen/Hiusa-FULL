import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { getApprovalRequests, getSubmittedApprovals, reviewApprovalRequest } from './approvalService';

vi.mock('./api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));

describe('approvalService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the requests awaiting the caller without a scope', () => {
    getApprovalRequests({ status: 'pending' });
    expect(api.get).toHaveBeenCalledWith('/approval-requests', { params: { status: 'pending' } });
  });

  it('lists what the caller submitted with scope=submitted and keeps the other filters', () => {
    getSubmittedApprovals({ status: 'all', entity_type: 'event' });
    expect(api.get).toHaveBeenCalledWith('/approval-requests', { params: { status: 'all', entity_type: 'event', scope: 'submitted' } });
  });

  it('does not let a caller override the submitted scope', () => {
    getSubmittedApprovals({ scope: 'awaiting' });
    expect(api.get).toHaveBeenCalledWith('/approval-requests', { params: { scope: 'submitted' } });
  });

  it('works with no params', () => {
    getSubmittedApprovals();
    expect(api.get).toHaveBeenCalledWith('/approval-requests', { params: { scope: 'submitted' } });
  });

  it('keeps reviewing a request through PATCH', () => {
    reviewApprovalRequest(4, { status: 'approved' });
    expect(api.patch).toHaveBeenCalledWith('/approval-requests/4', { status: 'approved' });
  });
});
