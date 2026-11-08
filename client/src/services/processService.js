import api from './api';

export const getProcessStatus = () => api.get('/process/status', { cache: false });
