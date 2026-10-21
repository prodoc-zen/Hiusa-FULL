import api from './api';

export const getApprovalRequests = (params) =>
  api.get('/approval-requests', { params, cache: false });

export const getApprovalRequest = (id) =>
  api.get(`/approval-requests/${id}`, { cache: false });

export const getSubmittedApprovals = (params) =>
  api.get('/approval-requests', { params: { ...params, scope: 'submitted' }, cache: false });

export const reviewApprovalRequest = (id, data) =>
  api.patch(`/approval-requests/${id}`, data);
