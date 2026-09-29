import api from './api';

export const getAdminDashboard = (months = 6) => api.get('/admin/dashboard', { params: { months } });
