import api from './api';

export const getRegistrationColleges = () => api.get('/organization-applications/colleges');
export const getApplicationRequirements = () => api.get('/organization-applications/requirements', { cache: false });
export const getRejectedApplication = (id, query) => api.get(`/organization-applications/${id}/edit?${query}`, { cache: false });
export const requestApplicationEditLink = (details) => api.post('/organization-applications/edit-link', details);
export const submitOrganizationApplication = (fields, files) => {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.append(key, value));
  Object.entries(files).forEach(([id, file]) => data.append(`files[${id}]`, file));
  return api.post('/organization-applications', data);
};
export const getOrganizationApplications = (params) => api.get('/organization-applications', { params });
export const reviewOrganizationApplication = (id, data) => api.patch(`/organization-applications/${id}/review`, data);
export const resubmitRejectedApplication = (id, query, fields, files) => {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.append(key, value));
  Object.entries(files).filter(([, file]) => file).forEach(([id, file]) => data.append(`files[${id}]`, file));
  return api.post(`/organization-applications/${id}/edit?${query}`, data);
};
