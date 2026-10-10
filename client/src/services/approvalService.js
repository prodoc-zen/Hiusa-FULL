import api from './api';

export const getApprovalRequests = (params) =>
  api.get('/approval-requests', { params });

export const getSubmittedApprovals = (params) =>
  api.get('/approval-requests', { params: { ...params, scope: 'submitted' } });

export const reviewApprovalRequest = (id, data) =>
  api.patch(`/approval-requests/${id}`, data);
