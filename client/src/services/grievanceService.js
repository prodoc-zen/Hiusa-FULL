import api from './api';

export const getGrievances = (params) => api.get('/grievances', { params });

export const getGrievance = (id) => api.get(`/grievances/${id}`);

export const createGrievance = (data) => api.post('/grievances', data);

export const updateGrievanceStatus = (id, data) => api.patch(`/grievances/${id}/status`, data);

export const deleteGrievance = (id) => api.delete(`/grievances/${id}`);
