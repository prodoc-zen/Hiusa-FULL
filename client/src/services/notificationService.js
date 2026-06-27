import api from './api';

export const getNotifications = () =>
  api.get('/notifications');

export const markRead = (id) =>
  api.patch(`/notifications/${id}/read`);

export const markAllRead = () =>
  api.patch('/notifications/read-all');

export const sendNotification = (data) =>
  api.post('/notifications', data);
