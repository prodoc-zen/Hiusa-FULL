import api from './api';

const registrationForm = (fields, files) => {
  const data = new FormData();
  ['name', 'acronym', 'description', 'color'].forEach((key) => {
    if (fields[key] !== undefined && fields[key] !== null) data.append(key, fields[key]);
  });
  Object.entries(files).forEach(([requirementTypeId, file]) => data.append(`files[${requirementTypeId}]`, file));
  return data;
};

export const getCollegeOrganizations = (params) => api.get('/college/organizations', { params });

export const getRegistrationRequirements = () => api.get('/college/organizations/requirements');

export const registerOrganization = (fields, files) => api.post('/college/organizations', registrationForm(fields, files));

export const resubmitOrganization = (id, fields, files = {}) => {
  const data = registrationForm(fields, files);
  data.append('_method', 'PUT');
  return api.post(`/college/organizations/${id}`, data);
};
