import api from './api';

export const updateProfile = (data) =>
  api.put('/user/profile', data);

export const updatePassword = (data) =>
  api.put('/user/password', data);

export const getMyActivity = (page = 1) =>
  api.get('/me/activity', { params: { page } });
