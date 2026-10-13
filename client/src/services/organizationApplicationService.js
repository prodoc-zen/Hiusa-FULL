import api from './api';

export const getRegistrationColleges = () => api.get('/organization-applications/colleges');
export const submitOrganizationApplication = (data) => api.post('/organization-applications', data);
export const getOrganizationApplications = (params) => api.get('/organization-applications', { params });
export const reviewOrganizationApplication = (id, data) => api.patch(`/organization-applications/${id}/review`, data);
