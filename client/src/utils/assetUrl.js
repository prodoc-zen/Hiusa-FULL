import { resolveRuntimeApiUrl } from './runtimeApiUrl';

const API_ORIGIN = (() => {
  const configuredUrl = resolveRuntimeApiUrl(import.meta.env.VITE_API_URL);

  try {
    const url = new URL(configuredUrl, window.location.origin);
    return url.pathname.replace(/\/+$/, '').endsWith('/api')
      ? `${url.origin}${url.pathname.replace(/\/api\/?$/, '')}`
      : `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return window.location.origin;
  }
})();

export function resolveAssetUrl(url) {
  if (!url) return null;
  if (/^(https?:|blob:|data:)/i.test(url)) return url;

  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}
