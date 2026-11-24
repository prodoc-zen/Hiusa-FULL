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

export const submitBudget = (id) =>
  api.patch(`/budgets/${id}/submit`);

export const deleteBudget = (id) =>
  api.delete(`/budgets/${id}`);

// Transactions
export const getTransactions = (params) =>
  api.get('/transactions', { params });

export const getTransactionSummary = (params) =>
  api.get('/transactions/summary', { params });

// A transaction can carry the official receipt file, so it travels as multipart form data. A cleared link or
// reference goes as an empty value, which the server reads as null; a field left out would stay as it was.
function transactionFormData(data) {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === 'receipt_file') {
      if (value) formData.append(key, value);
      return;
    }
    formData.append(key, value === null ? '' : value);
  });
  return formData;
}

export const createTransaction = (data) =>
  api.post('/transactions', transactionFormData(data));

// Laravel reads a multipart PUT only through method spoofing, so an edit is a POST that says _method=PUT.
export const updateTransaction = (id, data) => {
  const formData = transactionFormData(data);
  formData.append('_method', 'PUT');
  return api.post(`/transactions/${id}`, formData);
};

// An entry is archived, never deleted: it leaves every total and stays on record with who archived it and why.
export const archiveTransaction = (id, reason) =>
  api.patch(`/transactions/${id}/archive`, { reason });

// The history answers a click, so it is never read from the short cache.
export const getTransactionHistory = (id) =>
  api.get(`/transactions/${id}/history`, { cache: false });

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

export const downloadFinancialReportDocument = (reportId, index) =>
  api.get(`/financial-reports/${reportId}/documents/${index}`, { responseType: 'blob' });

// Checks before a report is sent. The findings decide the next click, so they are never read from the short cache.
export const getReportChecks = (id) =>
  api.get(`/financial-reports/${id}/checks`, { cache: false });

export const explainReportChecks = (id) =>
  api.post(`/financial-reports/${id}/checks/explain`);

export const ignoreReportCheck = (id, key, reason) =>
  api.post(`/financial-reports/${id}/checks/ignore`, { key, reason });

// The date the SAO asks every organization to send its financial report by.
export const getFinancialReportDeadline = () =>
  api.get('/financial-report-deadline', { cache: false });

export const setFinancialReportDeadline = (deadlineAt, newRound = false) =>
  api.put('/financial-report-deadline', { deadline_at: deadlineAt, new_round: newRound });
