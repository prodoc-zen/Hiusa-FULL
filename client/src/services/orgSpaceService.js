import api from './api';

export const getOrganizationSpace = (organizationId) => api.get(`/college/organizations/${organizationId}/space`, { cache: false });
