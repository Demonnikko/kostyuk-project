export class ApiError extends Error {
  constructor(message, { code, status = 0, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.code = code || 'request_failed';
    this.status = status;
  }
}

function requestUrl(baseUrl, path) {
  if (!path) return baseUrl;
  if (/^https?:\/\//i.test(path)) return path;
  // Абсолютный путь от корня (например '/api/seats?...') используем как есть,
  // не приклеивая к baseUrl — иначе получится '/api/vk-mini-app/api/seats'.
  if (path.startsWith('/')) return path;
  if (path.startsWith('?')) return `${baseUrl}${path}`;
  return `${baseUrl.replace(/\/$/, '')}/${path}`;
}

export function createApiClient({
  baseUrl = '/api/vk-mini-app',
  sessionToken = '',
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

    try {
      const response = await fetchImpl(requestUrl(baseUrl, path), {
        ...options,
        headers,
        signal: controller.signal,
      });
      let data;
      try {
        data = await response.json();
      } catch (cause) {
        throw new ApiError('Invalid JSON response', { code: 'invalid_response', status: response.status, cause });
      }
      if (!response.ok) {
        throw new ApiError(data?.error || `Request failed with status ${response.status}`, {
          code: 'http_error',
          status: response.status,
        });
      }
      return data;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      if (controller.signal.aborted) {
        throw new ApiError('Request timed out', { code: 'timeout', cause });
      }
      throw new ApiError('Network request failed', { code: 'network_error', cause });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health: () => request('?action=health'),
    getJson: (path = '', options = {}) => request(path, { ...options, method: 'GET' }),
    postJson: (path = '', body, options = {}) => request(path, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(body),
    }),
  };
}
