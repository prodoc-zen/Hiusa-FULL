import api from './api';

export const getClearancePeriods = (params) => api.get('/clearance-periods', { params });

export const createClearancePeriod = (data) => api.post('/clearance-periods', data);

export const getClearancePeriodStudents = (periodId, params) =>
  api.get(`/clearance-periods/${periodId}/students`, { params });

export const getMyClearances = () => api.get('/clearances/mine');

export const getClearanceSignatures = (params) => api.get('/clearance-signatures', { params });

export const updateClearanceSignature = (id, data) => api.patch(`/clearance-signatures/${id}`, data);
