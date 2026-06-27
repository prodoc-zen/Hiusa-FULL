import api from './api';

export const getOrders = (params) =>
  api.get('/orders', { params });

export const placeOrder = (data) =>
  api.post('/orders', data);

export const updateOrderStatus = (id, status) =>
  api.patch(`/orders/${id}/status`, { status });

export const claimByToken = (claim_token) =>
  api.post('/orders/claim', { claim_token });
