import axios from 'axios';

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

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
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
