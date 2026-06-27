import api from './api';

// Budgets
export const getBudgets = () =>
  api.get('/budgets');

export const createBudget = (data) =>
  api.post('/budgets', data);

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

export const deleteTransaction = (id) =>
  api.delete(`/transactions/${id}`);

// Forecasts
export const getForecasts = () =>
  api.get('/forecasts');

export const createForecast = (data) =>
  api.post('/forecasts', data);

export const updateForecast = (id, data) =>
  api.put(`/forecasts/${id}`, data);

export const deleteForecast = (id) =>
  api.delete(`/forecasts/${id}`);
