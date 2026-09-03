import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const APP_ID = '54751520';
const SERVER_SECRET = 'test-vk-server-secret';

// Помощник: строит валидную подпись строго по официальному алгоритму VK
// (vk_* отсортированы, key=encodeURIComponent(value) через &, HMAC-SHA256,
// base64 -> +→-, /→_, убрать хвостовые "=").
function signLaunch(params) {
  const vkPairs = Object.entries(params)
    .filter(([k]) => k.startsWith('vk_'))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const queryString = vkPairs
    .map(([k, v], i) => `${i === 0 ? '' : '&'}${k}=${encodeURIComponent(v)}`)
    .join('');
  const sign = createHmac('sha256', SERVER_SECRET)
    .update(queryString)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const all = { ...params, sign };
  return Object.entries(all)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

// Реальный набор launch-параметров VK (БЕЗ vk_ts — VK его не присылает).
const REAL_PARAMS = {
  vk_access_token_settings: '',
  vk_app_id: APP_ID,
  vk_are_notifications_enabled: '1',
  vk_is_app_user: '1',
  vk_language: 'ru',
  vk_platform: 'android',
  vk_user_id: '494075',
};

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test('accepts a valid VK HMAC launch signature for app 54751520 (no vk_ts)', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const launch = signLaunch(REAL_PARAMS);
  assert.deepEqual(
    verifyVkLaunchParams(launch, SERVER_SECRET),
    { ok: true, userId: '494075', appId: APP_ID, reason: null },
  );
});

test('accepts values with spaces and special chars (encodeURIComponent, not "+")', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const launch = signLaunch({ ...REAL_PARAMS, vk_ref: 'some ref value & more' });
  assert.equal(verifyVkLaunchParams(launch, SERVER_SECRET).ok, true);
});

test('rejects launch parameters changed after VK signed them', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const launch = signLaunch(REAL_PARAMS).replace('vk_user_id=494075', 'vk_user_id=999');
  assert.equal(verifyVkLaunchParams(launch, SERVER_SECRET).reason, 'invalid_signature');
});

test('rejects a valid signature issued for a different VK app ID', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const launch = signLaunch({ ...REAL_PARAMS, vk_app_id: '54751521' });
  assert.equal(verifyVkLaunchParams(launch, SERVER_SECRET).reason, 'wrong_app_id');
});

test('rejects launch params missing sign or vk_ params', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  assert.equal(verifyVkLaunchParams('vk_app_id=54751520&vk_user_id=1', SERVER_SECRET).reason, 'invalid_params');
  assert.equal(verifyVkLaunchParams('sign=abc', SERVER_SECRET).reason, 'invalid_params');
  assert.equal(verifyVkLaunchParams('', SERVER_SECRET).reason, 'invalid_params');
});

test('rejects when secret is missing', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const launch = signLaunch(REAL_PARAMS);
  assert.equal(verifyVkLaunchParams(launch, '').reason, 'invalid_params');
});

test('handles URLSearchParams and object inputs equivalently', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const launch = signLaunch(REAL_PARAMS);
  const asString = verifyVkLaunchParams(launch, SERVER_SECRET);
  const asSearch = verifyVkLaunchParams(new URLSearchParams(launch), SERVER_SECRET);
  assert.equal(asString.ok, true);
  assert.equal(asSearch.ok, true);
});

test('health endpoint is public and exposes no secret or session data', async () => {
  const { default: handler } = await import('../api/_endpoints/vk-mini-app.js');
  const res = createResponse();
  await handler({ method: 'GET', query: { action: 'health' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, service: 'vk-mini-app', appId: APP_ID });
  assert.doesNotMatch(JSON.stringify(res.body), /secret|token|process\.env/i);
});

test('session endpoint issues a short-lived token only after launch validation', async (t) => {
  const previous = process.env.VK_MINI_APP_SERVER_SECRET;
  process.env.VK_MINI_APP_SERVER_SECRET = SERVER_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.VK_MINI_APP_SERVER_SECRET;
    else process.env.VK_MINI_APP_SERVER_SECRET = previous;
  });

  const { default: handler } = await import('../api/_endpoints/vk-mini-app.js');
  const launch = signLaunch(REAL_PARAMS);
  const res = createResponse();
  await handler({
    method: 'POST',
    query: {},
    headers: {},
    body: { action: 'session', launchParams: launch },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.userId, '494075');
  assert.equal(res.body.appId, APP_ID);
  assert.equal(res.body.expiresIn, 300);
  assert.match(res.body.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('session endpoint rejects a tampered launch with 401', async (t) => {
  const previous = process.env.VK_MINI_APP_SERVER_SECRET;
  process.env.VK_MINI_APP_SERVER_SECRET = SERVER_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.VK_MINI_APP_SERVER_SECRET;
    else process.env.VK_MINI_APP_SERVER_SECRET = previous;
  });
  const { default: handler } = await import('../api/_endpoints/vk-mini-app.js');
  const launch = signLaunch(REAL_PARAMS).replace('vk_user_id=494075', 'vk_user_id=1');
  const res = createResponse();
  await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'session', launchParams: launch } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test('verifyVkSessionToken accepts a freshly issued token and rejects tampering/expiry', async () => {
  const { default: handler, verifyVkSessionToken } = await import('../api/_endpoints/vk-mini-app.js');
  const previous = process.env.VK_MINI_APP_SERVER_SECRET;
  process.env.VK_MINI_APP_SERVER_SECRET = SERVER_SECRET;
  try {
    const launch = signLaunch(REAL_PARAMS);
    const res = createResponse();
    await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'session', launchParams: launch } }, res);
    const token = res.body.sessionToken;

    const good = verifyVkSessionToken(token, SERVER_SECRET);
    assert.equal(good.ok, true);
    assert.equal(good.userId, '494075');

    // Подмена секрета -> отказ.
    assert.equal(verifyVkSessionToken(token, 'other-secret').ok, false);
    // Мусор -> отказ, без исключений.
    assert.equal(verifyVkSessionToken('garbage', SERVER_SECRET).reason, 'malformed');
    assert.equal(verifyVkSessionToken('', SERVER_SECRET).reason, 'no_token');
  } finally {
    if (previous === undefined) delete process.env.VK_MINI_APP_SERVER_SECRET;
    else process.env.VK_MINI_APP_SERVER_SECRET = previous;
  }
});

test('verifyVkSessionFromRequest reads Bearer header', async () => {
  const { default: handler, verifyVkSessionFromRequest } = await import('../api/_endpoints/vk-mini-app.js');
  const previous = process.env.VK_MINI_APP_SERVER_SECRET;
  process.env.VK_MINI_APP_SERVER_SECRET = SERVER_SECRET;
  try {
    const launch = signLaunch(REAL_PARAMS);
    const res = createResponse();
    await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'session', launchParams: launch } }, res);
    const token = res.body.sessionToken;
    const okReq = verifyVkSessionFromRequest({ headers: { authorization: `Bearer ${token}` } }, SERVER_SECRET);
    assert.equal(okReq.ok, true);
    const noReq = verifyVkSessionFromRequest({ headers: {} }, SERVER_SECRET);
    assert.equal(noReq.ok, false);
  } finally {
    if (previous === undefined) delete process.env.VK_MINI_APP_SERVER_SECRET;
    else process.env.VK_MINI_APP_SERVER_SECRET = previous;
  }
});

test('API client sends sessions, parses JSON, and normalizes HTTP failures', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 403, async json() { return { error: 'Forbidden detail' }; } };
  };
  const { createApiClient } = await import('../vk-mini-app/lib/api.js');
  const client = createApiClient({ baseUrl: '/api/vk-mini-app', sessionToken: 'session-token', fetchImpl });

  await assert.rejects(client.getJson('?action=private'), (error) => {
    assert.deepEqual(
      { name: error.name, code: error.code, status: error.status, message: error.message },
      { name: 'ApiError', code: 'http_error', status: 403, message: 'Forbidden detail' },
    );
    return true;
  });
  assert.equal(calls[0].url, '/api/vk-mini-app?action=private');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer session-token');
});

test('API client normalizes request timeouts', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
  const { createApiClient } = await import('../vk-mini-app/lib/api.js');
  const client = createApiClient({ baseUrl: '/api/vk-mini-app', fetchImpl, timeoutMs: 5 });

  await assert.rejects(client.health(), (error) => {
    assert.equal(error.code, 'timeout');
    assert.equal(error.status, 0);
    return true;
  });
});
