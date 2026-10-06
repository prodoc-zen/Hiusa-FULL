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
export const createCollection = (data) => api.post('/collections', data);
export const verifyCollection = (id) => api.patch(`/collections/${id}/verify`);
export const recordRemittance = (id, data) => api.post(`/collections/${id}/remittances`, data);
export const getCashAdvances = (params) => api.get('/cash-advances', { params });
export const createCashAdvance = (data) => api.post('/cash-advances', data);
export const approveCashAdvance = (id) => api.patch(`/cash-advances/${id}/approve`);
export const releaseCashAdvance = (id) => api.patch(`/cash-advances/${id}/release`);
export const repayCashAdvance = (id, data) => api.post(`/cash-advances/${id}/repayments`, data);
export const getStudentDebts = (params) => api.get('/student-debts', { params });
export const createInvoice = (data) => api.post('/invoices', data);
export const recordInvoicePayment = (invoiceId, data) => api.post(`/invoices/${invoiceId}/payments`, data);
export const updateInvoiceStatus = (invoiceId, data) => api.patch(`/invoices/${invoiceId}/status`, data);
export const getAuditLogs = (params) => api.get('/audit-logs', { params });
export const exportAuditLogs = (params) => api.get('/audit-logs/export', { params, responseType: 'blob' });

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
export const getFinancialSemesters = () => api.get('/financial-semesters');

export const createFinancialSemester = (data) => api.post('/financial-semesters', data);

export const getFinancialReports = (params) =>
  api.get('/financial-reports', { params });

export const generateFinancialReport = (data) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (key === 'signatories') {
      Object.entries(value).forEach(([role, name]) => formData.append(`signatories[${role}]`, name));
      return;
    }
    formData.append(key, value);
  });
  return api.post('/financial-reports/generate', formData);
};

export const getFinancialReport = (id) =>
  api.get(`/financial-reports/${id}`);

export const downloadFinancialReportPdf = (id, inline = false) =>
  api.get(`/financial-reports/${id}/pdf`, { params: inline ? { inline: 1 } : undefined, responseType: 'blob' });

export const submitFinancialReport = (id, files = []) => {
  const formData = new FormData();
  files.forEach((file) => formData.append('supporting_documents[]', file));
  return api.post(`/financial-reports/${id}/submit`, formData);
};
