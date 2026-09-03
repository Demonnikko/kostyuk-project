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

  const verified = verifyVkLaunchParams(body.launchParams, secret, SESSION_TTL_SECONDS);
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
