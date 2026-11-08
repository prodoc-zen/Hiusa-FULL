import api from './api';

export const getCollegePeople = (params) => api.get('/college/people', { params, cache: false });

export const inviteCollegeStaff = (data = {}) => api.post('/college/staff/invitations', data);
