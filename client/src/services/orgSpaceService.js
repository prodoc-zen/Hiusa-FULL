import api from './api';

export const getOrganizationSpace = (organizationId) => api.get(`/college/organizations/${organizationId}/space`, { cache: false });

export const getOrganizationTransactions = (organizationId, params = {}) => api.get(`/college/organizations/${organizationId}/space/transactions`, { params, cache: false });
