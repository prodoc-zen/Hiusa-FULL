import api from './api';

export const getCollegeOrganizations = (params) => api.get('/college/organizations', { params, cache: false });
export const getCollegeOverview = () => api.get('/college/overview', { cache: false });
export const getCollegeStaff = () => api.get('/college/staff', { cache: false });
export const addCollegeStaff = (data) => api.post('/college/staff', data);
export const inviteCollegeStaff = (data) => api.post('/college/staff/invitations', data);
export const getStaffRecords = (params) => api.get('/college/staff/records', { params, cache: false });
export const removeCollegeStaff = (schoolId) => api.delete(`/college/staff/${schoolId}`);
