import api from './api';

export const getApprovalRequests = (params) =>
  api.get('/approval-requests', { params, cache: false });

export const getApprovalRequest = (id) =>
  api.get(`/approval-requests/${id}`, { cache: false });

export const getSubmittedApprovals = (params) =>
  api.get('/approval-requests', { params: { ...params, scope: 'submitted' }, cache: false });

export const reviewApprovalRequest = (id, data) =>
  api.patch(`/approval-requests/${id}`, data);

// Saves one event file's Accepted mark as the reviewer makes it, so it is still there after a reload.
export const markApprovalFile = (id, fileId, status) =>
  api.patch(`/approval-requests/${id}/files/${fileId}`, { status });

// Saves the Accepted mark on several files in one call, all or none. files is [{ id, status: 'ok' | 'none' }].
export const markApprovalFiles = (id, files) =>
  api.patch(`/approval-requests/${id}/files`, { files });
