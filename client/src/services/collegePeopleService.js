import api from './api';

export const getCollegePeople = (params) => api.get('/college/people', { params, cache: false });
