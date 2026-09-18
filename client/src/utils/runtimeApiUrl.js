const DEFAULT_API_URL = 'http://localhost:8000/api';

export function resolveRuntimeApiUrl(configuredUrl) {
  return configuredUrl?.trim() || DEFAULT_API_URL;
}
