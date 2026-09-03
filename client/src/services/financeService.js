import api from './api';

// Budgets
export const getBudgets = (params) =>
  api.get('/budgets', { params });

export const createBudget = (data) =>
  api.post('/budgets', data);

export const generateBudgetAdvice = (id) =>
  api.post(`/budgets/${id}/advice`);

export const updateBudget = (id, data) =>
  api.put(`/budgets/${id}`, data);

export const deleteBudget = (id) =>
  api.delete(`/budgets/${id}`);

// Transactions
export const getTransactions = (params) =>
  api.get('/transactions', { params });

export const getTransactionSummary = (params) =>
  api.get('/transactions/summary', { params });

export const createTransaction = (data) =>
  api.post('/transactions', data);

export const updateTransaction = (id, data) =>
  api.put(`/transactions/${id}`, data);

export const deleteTransaction = (id) =>
  api.delete(`/transactions/${id}`);

export const getPersonalReceipts = () =>
  api.get('/transactions/personal-receipts');

export const getInvoices = () => api.get('/invoices');
export const getFinancialDashboard = () => api.get('/financial-dashboard');
export const getCollections = (params) => api.get('/collections', { params });
export const getStudentDebts = (params) => api.get('/student-debts', { params });
export const createInvoice = (data) => api.post('/invoices', data);
export const recordInvoicePayment = (invoiceId, data) => api.post(`/invoices/${invoiceId}/payments`, data);
export const getAuditLogs = (params) => api.get('/audit-logs', { params });

// Forecasts
export const getForecasts = (params) =>
  api.get('/forecasts', { params });

export const generateForecast = (data = {}) =>
  api.post('/forecasts/generate', data);

export const createForecast = (data) =>
  api.post('/forecasts', data);

export const updateForecast = (id, data) =>
  api.put(`/forecasts/${id}`, data);

export const deleteForecast = (id) =>
  api.delete(`/forecasts/${id}`);

// Reports
export const getFinancialReports = (params) =>
  api.get('/financial-reports', { params });

export const generateFinancialReport = (data) =>
  api.post('/financial-reports/generate', data);
