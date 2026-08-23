const API_ORIGIN = (() => {
  const configuredUrl = import.meta.env.VITE_API_URL;

  if (!configuredUrl) {
    return window.location.origin;
  }

  try {
    const url = new URL(configuredUrl, window.location.origin);
    const configuredIsLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
    const browserIsRemote = !['localhost', '127.0.0.1'].includes(window.location.hostname);

    if (configuredIsLocal && browserIsRemote) {
      url.hostname = window.location.hostname;
    }

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
