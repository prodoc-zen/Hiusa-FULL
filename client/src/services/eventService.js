import api from './api';

export const getEvents = (params) =>
  api.get('/events', { params });

export const getEvent = (id) =>
  api.get(`/events/${id}`);

export const createEvent = (data) =>
  api.post('/events', data);

export const updateEvent = (id, data) =>
  api.put(`/events/${id}`, data);

export const deleteEvent = (id) =>
  api.delete(`/events/${id}`);

export const updateEventStatus = (id, status) =>
  api.patch(`/events/${id}/status`, { status });

export const getAttendance = (id) =>
  api.get(`/events/${id}/attendance`);

export const recordAttendance = (id, data) =>
  api.post(`/events/${id}/attendance`, data);
