import api from './api';

export const getOrganizations = () => {
  return api.get('/organizations');
};
