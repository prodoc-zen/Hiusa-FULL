import api from './api';

const formData = (fields, files) => {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) data.append(key, value);
  });
  Object.entries(files).filter(([, file]) => file).forEach(([id, file]) => data.append(`files[${id}]`, file));
  return data;
};

export const getMyOrganizationApplications = () => api.get('/my/organization-applications', { cache: false });
export const getMyOrganizationApplication = (id) => api.get(`/my/organization-applications/${id}`, { cache: false });
export const submitOrganizationApplication = (fields, files) => api.post('/my/organization-applications', formData(fields, files));
export const resubmitOrganizationApplication = (id, fields, files) => api.post(`/my/organization-applications/${id}/resubmit`, formData(fields, files));

export const getOrganizationApplications = (params) => api.get('/organization-applications', { params, cache: false });
export const getOrganizationApplication = (id) => api.get(`/organization-applications/${id}`, { cache: false });
export const reviewOrganizationApplication = (id, data) => api.patch(`/organization-applications/${id}/review`, data);
export const attachReviewFile = (id, file, requirementTypeId) => {
  const data = new FormData();
  data.append('file', file);
  if (requirementTypeId) data.append('requirement_type_id', requirementTypeId);
  return api.post(`/organization-applications/${id}/review-files`, data);
};
export const removeReviewFile = (id, fileId) => api.delete(`/organization-applications/${id}/review-files/${fileId}`);
