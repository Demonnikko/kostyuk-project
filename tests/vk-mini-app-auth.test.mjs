import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const APP_ID = '54751520';
const SERVER_SECRET = 'test-vk-server-secret';
const VALID_LAUNCH = 'vk_app_id=54751520&vk_ts=1700000000&vk_user_id=123&sign=oLRyuP4qF_nToXyphCKyXQPZgqy1WPK-0RQJn7Gk0Ik';

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

test('accepts a valid VK HMAC launch signature for app 54751520', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  assert.deepEqual(
    verifyVkLaunchParams(VALID_LAUNCH, SERVER_SECRET, 1_000_000_000),
    { ok: true, userId: '123', appId: APP_ID, reason: null },
  );
});

test('rejects launch parameters changed after VK signed them', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const tampered = VALID_LAUNCH.replace('vk_user_id=123', 'vk_user_id=999');
  assert.equal(verifyVkLaunchParams(tampered, SERVER_SECRET, 1_000_000_000).reason, 'invalid_signature');
});

test('rejects valid signatures issued for every other VK app ID', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  const wrongApp = 'vk_app_id=54751521&vk_ts=1700000000&vk_user_id=123&sign=lFdhexPFcDpbiNUVg5Sd6sRYHBirRZtizp498H4XLuU';
  assert.equal(verifyVkLaunchParams(wrongApp, SERVER_SECRET, 1_000_000_000).reason, 'wrong_app_id');
});

test('rejects a correctly signed launch outside the bounded age', async () => {
  const { verifyVkLaunchParams } = await import('../shared/vkLaunchParams.js');
  assert.equal(verifyVkLaunchParams(VALID_LAUNCH, SERVER_SECRET, 60).reason, 'expired');
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
  const launchParams = new URLSearchParams({
    vk_app_id: APP_ID,
    vk_ts: String(Math.floor(Date.now() / 1000)),
    vk_user_id: '123',
  });
  launchParams.sort();
  launchParams.set('sign', createHmac('sha256', SERVER_SECRET).update(launchParams.toString()).digest('base64url'));
  const res = createResponse();
  await handler({
    method: 'POST',
    query: {},
    headers: {},
    body: { action: 'session', launchParams: launchParams.toString() },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.userId, '123');
  assert.equal(res.body.appId, APP_ID);
  assert.equal(res.body.expiresIn, 300);
  assert.match(res.body.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('API client sends sessions, parses JSON, and normalizes HTTP failures', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: false,
      status: 403,
      async json() { return { error: 'Forbidden detail' }; },
    };
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
