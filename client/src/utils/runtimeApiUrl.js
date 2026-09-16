const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isPrivateIpv4(hostname) {
  if (/^10(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(hostname)) return true;

  const match = hostname.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function isDevelopmentHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || isPrivateIpv4(hostname);
}

export function resolveRuntimeApiUrl(configuredUrl, browserLocation = window.location) {
  const value = configuredUrl?.trim();
  if (!value) {
    return `${browserLocation.protocol}//${browserLocation.hostname}:8000/api`;
  }

  try {
    const parsed = new URL(value);
    const followsFrontendHost = parsed.protocol === 'http:'
      && parsed.port === '8000'
      && isDevelopmentHost(parsed.hostname)
      && isDevelopmentHost(browserLocation.hostname);

    // HIUSA's LAN startup runs Vite and Laravel on the same computer. Follow
    // the hostname used to open Vite so a DHCP address change cannot leave the
    // browser calling yesterday's host address.
    if (followsFrontendHost) parsed.hostname = browserLocation.hostname;

    return parsed.toString().replace(/\/$/, '');
  } catch {
    // Production uses the relative /api URL through Caddy.
    return value;
  }
}
