import api from './api';

export const getRegistrationColleges = () => api.get('/organization-applications/colleges');
export const getApplicationRequirements = () => api.get('/organization-applications/requirements', { cache: false });
export const submitOrganizationApplication = (fields, files) => {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.append(key, value));
  Object.entries(files).forEach(([id, file]) => data.append(`files[${id}]`, file));
  return api.post('/organization-applications', data);
};
export const getOrganizationApplications = (params) => api.get('/organization-applications', { params });
export const reviewOrganizationApplication = (id, data) => api.patch(`/organization-applications/${id}/review`, data);
