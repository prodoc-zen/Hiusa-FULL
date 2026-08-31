import api from './api';

export const getOrders = (params) =>
  api.get('/orders', { params });

export const getOrderAnalyticsUsers = (params) =>
  api.get('/orders/analytics/users', { params });

export const exportOrders = (params) =>
  api.get('/orders/export', { params, responseType: 'blob' });

export const placeOrder = (data) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') formData.append(key, value);
  });
  return api.post('/orders', formData);
};

export const submitOrderPayment = (id, data) => {
  const formData = new FormData();
  formData.append('payment_reference', data.payment_reference);
  formData.append('payment_proof', data.payment_proof);
  return api.post(`/orders/${id}/payment`, formData);
};

export const updateOrderStatus = (id, status, review_remarks = null, verified_amount = null) =>
  api.patch(`/orders/${id}/status`, { status, review_remarks, verified_amount });

export const claimByToken = (claim_token) =>
  api.post('/orders/claim', { claim_token });
