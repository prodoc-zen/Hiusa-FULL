import api from './api';

export const getRecords = async (params = {}, config = {}) => (
  await api.get('/records', { ...config, params })
).data;
