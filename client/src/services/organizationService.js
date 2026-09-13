import api from './api';

export const getOrganizations = (params) => {
  return api.get('/organizations', { params });
};
