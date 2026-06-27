import api from './api';

export const getTasks = (params) =>
  api.get('/tasks', { params });

export const createTask = (data) =>
  api.post('/tasks', data);

export const updateTask = (id, data) =>
  api.put(`/tasks/${id}`, data);

export const deleteTask = (id) =>
  api.delete(`/tasks/${id}`);

export const updateTaskStatus = (id, status) =>
  api.patch(`/tasks/${id}/status`, { status });
