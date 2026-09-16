import axios from 'axios';
import { createApiGetCache } from './apiCache';
import { resolveRuntimeApiUrl } from '../utils/runtimeApiUrl';

const api = axios.create({
  baseURL: resolveRuntimeApiUrl(import.meta.env.VITE_API_URL),
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

    // The authenticated API is rate-limited per user (see AppServiceProvider's
    // RateLimiter definitions). Surface the limit and its Retry-After so a page
    // can say "try again in a moment" instead of reporting a generic failure.
    if (status === 429) {
      error.isRateLimited = true;
      const retryAfter = Number(error.response.headers?.['retry-after']);
      error.retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
      error.userMessage = error.retryAfterSeconds
        ? `Too many requests. Please try again in ${error.retryAfterSeconds} seconds.`
        : 'Too many requests. Please wait a moment and try again.';
    }

    if (status >= 500) {
      error.isServerError = true;
    }

    return Promise.reject(error);
  }
);

export default api;
