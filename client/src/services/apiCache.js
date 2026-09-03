const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 75;
const DEFAULT_MAX_BYTES = 1_048_576;

function cloneData(data) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(data);
    } catch {
      // Fall through for values that cannot be structured-cloned.
    }
  }

  if (data === undefined || data === null || typeof data !== 'object') return data;
  return JSON.parse(JSON.stringify(data));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value).sort().reduce((sorted, key) => {
    sorted[key] = sortValue(value[key]);
    return sorted;
  }, {});
}

function isJsonResponse(response, maxBytes) {
  const contentType = String(response.headers?.['content-type'] || response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('application/json')) return false;
  if (typeof Blob !== 'undefined' && response.data instanceof Blob) return false;
  if (typeof ArrayBuffer !== 'undefined' && response.data instanceof ArrayBuffer) return false;

  try {
    return JSON.stringify(response.data).length <= maxBytes;
  } catch {
    return false;
  }
}

function responseSnapshot(response) {
  return {
    data: cloneData(response.data),
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

function responseFromSnapshot(snapshot, config, cacheStatus) {
  return {
    ...snapshot,
    data: cloneData(snapshot.data),
    config,
    request: null,
    clientCache: cacheStatus,
  };
}

export function createApiGetCache({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();
  const pending = new Map();
  let activeToken;
  let sessionVersion = 0;

  function clear() {
    entries.clear();
  }

  function currentSession() {
    const token = localStorage.getItem('auth_token') || '';
    if (token !== activeToken) {
      activeToken = token;
      sessionVersion += 1;
      entries.clear();
    }

    return sessionVersion;
  }

  function keyFor(url, config = {}) {
    return JSON.stringify({
      session: currentSession(),
      url,
      params: sortValue(config.params || {}),
      responseType: config.responseType || 'json',
      accept: config.headers?.Accept || config.headers?.accept || '',
    });
  }

  function prune() {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }

    while (entries.size >= maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  async function get(url, config, request) {
    if (config?.cache === false || ttlMs <= 0) return request();

    const key = keyFor(url, config);
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) {
      entries.delete(key);
      entries.set(key, cached);
      return responseFromSnapshot(cached.response, config, 'HIT');
    }
    if (cached) entries.delete(key);

    if (pending.has(key)) {
      const response = await pending.get(key);
      return responseFromSnapshot(response, config, 'DEDUPED');
    }

    const networkRequest = request().then((response) => {
      const snapshot = responseSnapshot(response);
      if (response.status === 200 && isJsonResponse(response, maxBytes)) {
        prune();
        entries.set(key, { response: snapshot, expiresAt: now() + ttlMs });
      }
      return snapshot;
    }).finally(() => pending.delete(key));

    pending.set(key, networkRequest);
    const response = await networkRequest;
    return responseFromSnapshot(response, config, 'MISS');
  }

  return { clear, get, size: () => entries.size };
}
