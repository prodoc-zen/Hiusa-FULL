import api from './api';

const unwrap = async (response) => (await response).data;

export const getSystemOverview = (params) => unwrap(api.get('/system/overview', { params }));
export const getSystemOrganizations = (params) => unwrap(api.get('/system/organizations', { params }));
export const createSystemOrganization = (payload) => unwrap(api.post('/system/organizations', payload));
export const updateSystemOrganization = (id, payload) => unwrap(api.put(`/system/organizations/${id}`, payload));
export const getSystemAdmins = (params) => unwrap(api.get('/system/admins', { params }));
export const createSystemAdmin = (payload) => unwrap(api.post('/system/admins', payload));
export const updateSystemAdmin = (id, payload) => unwrap(api.put(`/system/admins/${id}`, payload));
export const getGlobalAnnouncements = (params) => unwrap(api.get('/system/announcements', { params }));
export const createGlobalAnnouncement = (payload) => unwrap(api.post('/system/announcements', payload));
export const updateGlobalAnnouncement = (id, payload) => unwrap(api.put(`/system/announcements/${id}`, payload));
export const archiveGlobalAnnouncement = (id) => unwrap(api.patch(`/system/announcements/${id}/archive`));
