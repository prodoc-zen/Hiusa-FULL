import api from './api';

export const getFeeUsage = () => api.get('/student/fee-usage');
