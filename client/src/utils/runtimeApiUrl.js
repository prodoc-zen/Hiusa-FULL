export function resolveRuntimeApiUrl(configuredUrl, production = import.meta.env.PROD) {
  return configuredUrl?.trim() || (production ? '/api' : 'http://localhost:8000/api');
}
