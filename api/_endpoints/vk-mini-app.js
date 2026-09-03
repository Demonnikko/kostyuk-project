import crypto from 'node:crypto';
import { setCors } from '../../shared/cors.js';
import { verifyVkLaunchParams, VK_APP_ID } from '../../shared/vkLaunchParams.js';

const SESSION_TTL_SECONDS = 300;

function readBody(body) {
  if (typeof body !== 'string') return body || {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function createSessionToken(userId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    appId: VK_APP_ID,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`vk-mini-app-session.${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Проверяет серверную VK-сессию (Bearer-токен), выданную session endpoint.
 * Возвращает { ok, userId, reason }. Токен подписан тем же секретом и имеет TTL.
 * Используется мутирующими endpoints (book/huligan/matvey) для доверия vkUserId.
 * secret берётся из process.env.VK_MINI_APP_SERVER_SECRET.
 */
export function verifyVkSessionToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) {
    return { ok: false, userId: null, reason: 'no_token' };
  }
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, userId: null, reason: 'malformed' };
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`vk-mini-app-session.${payload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, userId: null, reason: 'bad_signature' };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, userId: null, reason: 'malformed' };
  }
  if (!data || data.appId !== VK_APP_ID || !data.sub) {
    return { ok: false, userId: null, reason: 'invalid_claims' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(data.exp) || now > data.exp) {
    return { ok: false, userId: null, reason: 'expired' };
  }
  return { ok: true, userId: String(data.sub), reason: null };
}

/**
 * Достаёт Bearer-токен из заголовка Authorization и проверяет его.
 * Возвращает { ok, userId, reason }. Не бросает исключений.
 */
export function verifyVkSessionFromRequest(req, secret) {
  const auth = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, userId: null, reason: 'no_token' };
  return verifyVkSessionToken(m[1].trim(), secret);
}

export default async function handler(req, res) {
  const isHealth = req.method === 'GET' && req.query?.action === 'health';
  setCors(req, res, { publicRead: isHealth, methods: 'GET, POST, OPTIONS' });

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (isHealth) {
    return res.status(200).json({ ok: true, service: 'vk-mini-app', appId: VK_APP_ID });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const body = readBody(req.body);
  if (body.action !== 'session' || typeof body.launchParams !== 'string') {
    return res.status(400).json({ ok: false, error: 'Invalid request' });
  }

  const secret = String(process.env.VK_MINI_APP_SERVER_SECRET || '').trim();
  if (!secret) {
    return res.status(503).json({ ok: false, error: 'VK Mini App service is not configured' });
  }

  const verified = verifyVkLaunchParams(body.launchParams, secret);
  if (!verified.ok) {
    return res.status(401).json({ ok: false, error: 'Invalid VK launch', reason: verified.reason });
  }

  return res.status(200).json({
    ok: true,
    userId: verified.userId,
    appId: verified.appId,
    sessionToken: createSessionToken(verified.userId, secret),
    expiresIn: SESSION_TTL_SECONDS,
  });
}
