import axios from 'axios';
import { createApiGetCache } from './apiCache';

function resolveApiUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();

  if (!configuredUrl) {
    return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  }

  try {
    const parsed = new URL(configuredUrl);
    const configuredIsLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    const browserIsRemote = !['localhost', '127.0.0.1'].includes(window.location.hostname);

    if (configuredIsLocal && browserIsRemote) {
      parsed.hostname = window.location.hostname;
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    // Keep relative API URLs unchanged.
  }

  return configuredUrl;
}

const api = axios.create({
  baseURL: resolveApiUrl(),
  headers: {
    Accept: 'application/json',
  },
});

const configuredCacheTtl = Number(import.meta.env.VITE_API_CACHE_TTL_MS);
const apiGetCache = createApiGetCache({
  ttlMs: Number.isFinite(configuredCacheTtl) && configuredCacheTtl >= 0
    ? configuredCacheTtl
    : 60_000,
});
const networkGet = api.get.bind(api);

api.get = (url, config = {}) => apiGetCache.get(
  url,
  config,
  () => networkGet(url, config),
);

export function clearApiCache() {
  apiGetCache.clear();
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => {
    if (!['get', 'head'].includes(String(response.config?.method || '').toLowerCase())) {
      clearApiCache();
    }

    return response;
  },
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
      clearApiCache();
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    if (status === 403) {
      error.isForbidden = true;
    }

    if (status === 422) {
      error.validationErrors = error.response.data?.errors ?? {};
    }

    if (status >= 500) {
      error.isServerError = true;
    }

    return Promise.reject(error);
  }
);

export default api;
