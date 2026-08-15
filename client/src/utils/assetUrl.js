const API_ORIGIN = (() => {
  const configuredUrl = import.meta.env.VITE_API_URL;

  if (!configuredUrl) {
    return window.location.origin;
  }

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
