import api from './api';

export const getCurrentEvaluation = () => api.get('/evaluation/current');

export const submitEvaluationResponse = (data) => api.post('/evaluation/responses', data);

export const getEvaluationResults = (params) => api.get('/evaluation/results', { params });

export const exportEvaluationResults = (params) =>
  api.get('/evaluation/results/export', { params, responseType: 'blob' });

export const getEvaluationWindows = (params) => api.get('/evaluation/windows', { params });

export const createEvaluationWindow = (data) => api.post('/evaluation/windows', data);

export const updateEvaluationWindow = (id, data) => api.patch(`/evaluation/windows/${id}`, data);
