import api from './api';

export const getOrders = (params) =>
  api.get('/orders', { params });

export const placeOrder = (data) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') formData.append(key, value);
  });
  return api.post('/orders', formData);
};

export const updateOrderStatus = (id, status, review_remarks = null) =>
  api.patch(`/orders/${id}/status`, { status, review_remarks });

export const claimByToken = (claim_token) =>
  api.post('/orders/claim', { claim_token });
