const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 75;
const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_TOTAL_BYTES = 5_242_880;

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
  if (value instanceof URLSearchParams) return { searchParams: value.toString() };
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value).sort().reduce((sorted, key) => {
    sorted[key] = sortValue(value[key]);
    return sorted;
  }, {});
}

function jsonResponseBytes(response, maxBytes) {
  const contentType = String(response.headers?.['content-type'] || response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('application/json')) return 0;
  if (typeof Blob !== 'undefined' && response.data instanceof Blob) return 0;
  if (typeof ArrayBuffer !== 'undefined' && response.data instanceof ArrayBuffer) return 0;
  const cacheControl = String(response.headers?.['cache-control'] || response.headers?.get?.('cache-control') || '');
  if (/\bno-store\b/i.test(cacheControl)) return 0;

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(response.data)).byteLength;
    return bytes <= maxBytes ? bytes : 0;
  } catch {
    return 0;
  }
}

function responseSnapshot(response) {
  return {
    data: cloneData(response.data),
    status: response.status,
    statusText: response.statusText,
    headers: { ...response.headers },
  };
}

function responseFromSnapshot(snapshot, config, cacheStatus) {
  return {
    ...snapshot,
    data: cloneData(snapshot.data),
    headers: { ...snapshot.headers },
    config,
    request: null,
    clientCache: cacheStatus,
  };
}

export function createApiGetCache({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();
  const pending = new Map();
  let activeToken;
  let sessionVersion = 0;
  let generation = 0;
  let totalBytes = 0;

  function clear() {
    generation += 1;
    entries.clear();
    pending.clear();
    totalBytes = 0;
  }

  function currentSession() {
    const token = localStorage.getItem('auth_token') || '';
    if (token !== activeToken) {
      activeToken = token;
      sessionVersion += 1;
      clear();
    }

    return sessionVersion;
  }

  function keyFor(url, config = {}) {
    return JSON.stringify({
      session: currentSession(),
      url,
      baseURL: config.baseURL || '',
      params: sortValue(config.params || {}),
      responseType: config.responseType || 'json',
      accept: config.headers?.Accept || config.headers?.accept || '',
      authorization: config.headers?.Authorization || config.headers?.authorization || '',
      ttlMs: config.cacheTtlMs ?? ttlMs,
    });
  }

  function removeEntry(key) {
    totalBytes -= entries.get(key)?.bytes || 0;
    entries.delete(key);
  }

  function prune(bytes) {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) removeEntry(key);
    }

    while (entries.size && (entries.size >= maxEntries || totalBytes + bytes > maxTotalBytes)) {
      removeEntry(entries.keys().next().value);
    }
  }

  async function get(url, config, request) {
    currentSession();
    const entryTtlMs = config?.cacheTtlMs ?? ttlMs;
    const key = keyFor(url, config);
    if (config?.cache === false) {
      removeEntry(key);
      pending.delete(key);
      return request();
    }
    if (entryTtlMs <= 0 || config?.signal || config?.cancelToken || config?.paramsSerializer
      || (config?.responseType && config.responseType !== 'json') || maxEntries <= 0 || maxTotalBytes <= 0) return request();

    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) {
      entries.delete(key);
      entries.set(key, cached);
      return responseFromSnapshot(cached.response, config, 'HIT');
    }
    if (cached) removeEntry(key);

    if (pending.has(key)) {
      const response = await pending.get(key);
      return responseFromSnapshot(response, config, 'DEDUPED');
    }

    const requestGeneration = generation;
    const networkRequest = request().then((response) => {
      const snapshot = responseSnapshot(response);
      const bytes = jsonResponseBytes(response, maxBytes);
      currentSession();
      // A mutation or profile switch can finish while this GET is still in flight.
      if (requestGeneration === generation && pending.get(key) === networkRequest
        && response.status === 200 && bytes > 0 && bytes <= maxTotalBytes) {
        prune(bytes);
        entries.set(key, { response: snapshot, expiresAt: now() + entryTtlMs, bytes });
        totalBytes += bytes;
      }
      return snapshot;
    }).finally(() => {
      if (pending.get(key) === networkRequest) pending.delete(key);
    });

    pending.set(key, networkRequest);
    const response = await networkRequest;
    return responseFromSnapshot(response, config, 'MISS');
  }

  return { clear, get, size: () => entries.size };
}
