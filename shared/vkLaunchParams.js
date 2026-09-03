import crypto from 'node:crypto';

const VK_APP_ID = '54751520';

function asSearchParams(value) {
  if (value instanceof URLSearchParams) return new URLSearchParams(value);
  if (typeof value === 'string') return new URLSearchParams(value.startsWith('?') ? value.slice(1) : value);
  if (value && typeof value === 'object') return new URLSearchParams(value);
  return new URLSearchParams();
}

function constantTimeSignatureMatch(received, expected) {
  try {
    const receivedBuffer = Buffer.from(received, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return receivedBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function verifyVkLaunchParams(searchParams, secret, maxAgeSeconds = 300) {
  const params = asSearchParams(searchParams);
  const sign = params.get('sign') || '';
  const appId = params.get('vk_app_id') || '';
  const userId = params.get('vk_user_id') || '';
  const timestamp = Number(params.get('vk_ts'));

  if (!secret || !sign || !appId || !userId || !Number.isInteger(timestamp)) {
    return { ok: false, userId: null, appId: appId || null, reason: 'invalid_params' };
  }

  const signedParams = new URLSearchParams();
  for (const [key, value] of params) {
    if (key.startsWith('vk_')) signedParams.append(key, value);
  }
  signedParams.sort();

  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedParams.toString())
    .digest('base64url');

  if (!constantTimeSignatureMatch(sign, expected)) {
    return { ok: false, userId: null, appId, reason: 'invalid_signature' };
  }
  if (appId !== VK_APP_ID) {
    return { ok: false, userId: null, appId, reason: 'wrong_app_id' };
  }

  const maxAge = Number(maxAgeSeconds);
  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (!Number.isFinite(maxAge) || maxAge <= 0 || age < 0 || age > maxAge) {
    return { ok: false, userId: null, appId, reason: 'expired' };
  }

  return { ok: true, userId, appId, reason: null };
}

export { VK_APP_ID };
