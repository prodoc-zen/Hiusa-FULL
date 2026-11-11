import axios from 'axios';
import { createApiGetCache } from './apiCache';
import { resolveRuntimeApiUrl } from '../utils/runtimeApiUrl';
import { clearAuthSession, rememberSignOutNotice } from '../utils/authSession';
import { readSelectedPeriod } from '../utils/academicPeriodStore';
import { readActiveSubAccount } from '../utils/subAccountStore';

const api = axios.create({
  baseURL: resolveRuntimeApiUrl(import.meta.env.VITE_API_URL),
  headers: {
    Accept: 'application/json',
  },
});

// Short on purpose: another role's session can change what this tab shows, and a
// tab only learns of its own changes. Reads that decide the next click pass
// `cache: false` in their service instead.
const configuredCacheTtl = Number(import.meta.env.VITE_API_CACHE_TTL_MS);
const apiGetCache = createApiGetCache({
  ttlMs: Number.isFinite(configuredCacheTtl) && configuredCacheTtl >= 0
    ? configuredCacheTtl
    : 5_000,
});
const SUBACCOUNT_SCOPED_PREFIXES = [
  '/budgets',
  '/transactions',
  '/financial-dashboard',
  '/collections',
  '/cash-advances',
  '/invoices',
  '/financial-reports',
  '/forecasts',
  '/events',
  '/elections',
  '/announcements',
  '/approval-requests',
  '/clearances/periods/',
  '/tasks',
  '/orders',
  '/merchandise',
  '/attendance',
  '/compliance',
  '/organizations',
  '/grievances',
];

function withSubAccountScope(url, config = {}) {
  try {
    const subAccount = readActiveSubAccount();
    if (!subAccount) return config;

    const rawUser = localStorage.getItem('user');
    const user = rawUser ? JSON.parse(rawUser) : null;
    if (user?.role !== 'DEPARTMENT_HEAD') return config;

    const path = String(url || '');
    if (path.includes('organization_id=') || config?.params?.organization_id != null) {
      return config;
    }

    const isScopedEndpoint = SUBACCOUNT_SCOPED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`)
    );
    if (!isScopedEndpoint) return config;

    return {
      ...config,
      params: {
        ...(config.params || {}),
        organization_id: Number(subAccount.id),
      },
    };
  } catch {
    return config;
  }
}

const networkGet = api.get.bind(api);

api.get = (url, config = {}) => {
  const scopedConfig = withSubAccountScope(url, config);
  return apiGetCache.get(
    url,
    scopedConfig,
    () => networkGet(url, scopedConfig),
  );
};

export function clearApiCache() {
  apiGetCache.clear();
}

function markPasswordChangeRequired() {
  try {
    const user = JSON.parse(localStorage.getItem('user')) || {};
    localStorage.setItem('user', JSON.stringify({ ...user, must_change_password: true }));
  } catch {
    localStorage.removeItem('user');
  }
}

api.interceptors.request.use((config) => {
  if (config.cache === false) config.headers.set('Cache-Control', 'no-cache');
  const token = localStorage.getItem('auth_token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const period = readSelectedPeriod();
  if (period) config.headers.set('X-Academic-Semester', String(period.id));

  return config;
});

api.interceptors.response.use(
  (response) => {
    const method = String(response.config?.method || '').toLowerCase();
    if (!['get', 'head'].includes(method)) {
      clearApiCache();
    }
    if (method === 'patch' && /^\/notifications\/(read-all|\d+\/read)$/.test(String(response.config?.url || ''))) {
      window.dispatchEvent(new Event('hiusa-notifications-changed'));
    }

    return response;
  },
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
      const hadSession = Boolean(localStorage.getItem('auth_token'));
      clearApiCache();
      clearAuthSession();
      if (error.config?.url !== '/login') {
        if (hadSession) rememberSignOutNotice('Your session ended. Sign in again to continue.');
        window.location.assign(hadSession ? '/login' : '/');
      }
      return Promise.reject(error);
    }

    if (status === 403) {
      error.isForbidden = true;

      // The profile this sign-in was opened with no longer works, for example after an election
      // handed its post to someone else. Signing in again picks a profile that does.
      if (error.response.data?.error_code === 'PROFILE_UNAVAILABLE') {
        clearApiCache();
        clearAuthSession();
        if (!['/', '/login'].includes(window.location.pathname)) {
          rememberSignOutNotice(error.response.data?.message);
          window.location.assign('/login');
        }
        return Promise.reject(error);
      }

      if (error.response.data?.error_code === 'PASSWORD_CHANGE_REQUIRED') {
        error.isPasswordChangeRequired = true;
        markPasswordChangeRequired();
        if (window.location.pathname !== '/change-password') {
          window.location.assign('/change-password');
        }
      }
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
