import api from './api';

const unwrap = async (response) => (await response).data;

export const getSystemOverview = (params) => unwrap(api.get('/system/overview', { params }));
export const getSystemOrganizations = (params) => unwrap(api.get('/system/organizations', { params }));
export const createSystemOrganization = (payload) => unwrap(api.post('/system/organizations', payload));
export const updateSystemOrganization = (id, payload) => unwrap(api.put(`/system/organizations/${id}`, payload));
export const getSystemColleges = () => unwrap(api.get('/system/colleges'));
export const createSystemCollege = (payload) => unwrap(api.post('/system/colleges', payload));
export const updateSystemCollege = (id, payload) => unwrap(api.put(`/system/colleges/${id}`, payload));
export const deleteSystemCollege = (id) => unwrap(api.delete(`/system/colleges/${id}`));
export const getAcademicYears = () => unwrap(api.get('/system/academic-years'));
export const createAcademicYear = (payload) => unwrap(api.post('/system/academic-years', payload));
export const updateAcademicYear = (id, payload) => unwrap(api.put(`/system/academic-years/${id}`, payload));
export const makeAcademicYearCurrent = (id) => unwrap(api.patch(`/system/academic-years/${id}/current`));
export const deleteAcademicYear = (id) => unwrap(api.delete(`/system/academic-years/${id}`));
export const getSystemAdmins = (params) => unwrap(api.get('/system/admins', { params }));
export const createSystemAdmin = (payload) => unwrap(api.post('/system/admins', payload));
export const updateSystemAdmin = (id, payload) => unwrap(api.put(`/system/admins/${id}`, payload));
export const deleteSystemAdmin = (id) => unwrap(api.delete(`/system/admins/${id}`));
export const initiateSystemAdminPasswordReset = (id) => unwrap(api.post(`/system/admins/${id}/password-reset`));
export const handoverSystemAdmin = (id, payload) => unwrap(api.post(`/system/admins/${id}/handover`, payload));
export const getSystemOrganizationMembers = (organizationId, params) => unwrap(api.get(`/system/organizations/${organizationId}/members`, { params }));
export const getGlobalAnnouncements = (params) => unwrap(api.get('/system/announcements', { params }));
export const createGlobalAnnouncement = (payload) => unwrap(api.post('/system/announcements', payload));
export const updateGlobalAnnouncement = (id, payload) => unwrap(api.put(`/system/announcements/${id}`, payload));
export const archiveGlobalAnnouncement = (id) => unwrap(api.patch(`/system/announcements/${id}/archive`));
