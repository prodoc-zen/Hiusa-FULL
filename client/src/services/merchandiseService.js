import api from './api';

export const getMerchandise = (params) =>
  api.get('/merchandise', { params });

export const createItem = (data) =>
  api.post('/merchandise', data);

export const updateItem = (id, data) =>
  api.put(`/merchandise/${id}`, data);

export const deleteItem = (id) =>
  api.delete(`/merchandise/${id}`);

export const adjustStock = (id, stock_quantity) =>
  api.patch(`/merchandise/${id}/stock`, { stock_quantity });
