import api from './api';

export const searchPeople = async (params, config = {}) => (
  await api.get('/people/search', { ...config, params })
).data.data;
