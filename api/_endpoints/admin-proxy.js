const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';
import { 
  setAdminPassword, readAdminPass,
  isAdminAuthorized,
  createAdminSessionToken,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  SECURE_PASS_PATH
 } from '../../shared/adminAuth.js';

// ── Белый список разрешённых Firebase-путей ──
const ALLOWED_PATH_PREFIXES = [
  'ticket_bookings',
  'ticket_seats',
  'ticket_config',
  'ticket_promo',
  'ticket_admin',
  'ticket_reminders',
  'ticket_reviews',
  'ticket_users',
  'admin_notifications',
  'ticket_checkin',
  'huligan_bookings',
  'huligan_config',
  'huligan_promo',
  'huligan_reviews',
  'huligan_seats',
  'bot_private_config',
  'private_orders',
  'bot_users',
  'matvey_bookings',
  'matvey_seats',
  'matvey_config',
  'matvey_promo',
  'matvey_reviews',
  'matvey_users',
  'analytics',
  'finances',
];

function isPathAllowed(path) {
  if (path === SECURE_PASS_PATH) return true;
  return ALLOWED_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'));
}

// Локальный обход выключен по умолчанию и требует явного одноразового opt-in.
const IS_LOCAL_DEV = process.env.ALLOW_INSECURE_ADMIN_DEV === 'true'
  && process.env.NODE_ENV !== 'production';

function setSessionCookie(res) {
  const token = createAdminSessionToken();
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`);
}

// ── Server-side rate limiting (per IP, in-memory) ──
const _rl = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const e = _rl.get(ip) || { count: 0, resetAt: now + 30000 };
  if (now > e.resetAt) { e.count = 0; e.resetAt = now + 30000; }
  e.count++;
  _rl.set(ip, e);
  return e.count <= 120;
}

export default async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const ip = String(
      req.headers['x-real-ip']
      || req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']
      || req.socket?.remoteAddress
      || 'unknown'
    ).split(',')[0].trim().slice(0, 64);
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Try again in 30 seconds.' });

    const adminPass = readAdminPass(req, req.body);
    const method = req.method;
    const action = String(req.query.action || '');
    const path = String(req.query.path || '').replace(/^\/+/, '');

    if (!FIREBASE_SECRET) return res.status(500).json({ error: 'FIREBASE_SECRET is not configured' });

    try {
        const secretAuth = `?auth=${FIREBASE_SECRET}`;

        if (action === 'session') {
            if (method === 'DELETE') {
                res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
                return res.json({ ok: true });
            }
            const authorized = await isAdminAuthorized(req, req.body);
            if (!authorized && !IS_LOCAL_DEV) return res.status(401).json({ error: 'Unauthorized' });
            if (method === 'POST' || method === 'GET') setSessionCookie(res);
            const cfgRes = await fetch(`${FB_URL}/ticket_config.json${secretAuth}`);
            const cfg = await cfgRes.json().catch(() => null);
            if (!cfgRes.ok) return res.status(502).json({ error: 'Failed to load admin config' });
            return res.json({ ok: true, config: cfg });
        }

        if (!path) return res.status(400).json({ error: 'No path' });
        if (!isPathAllowed(path)) return res.status(403).json({ error: 'Path not allowed' });

        // 1) Verify password or the signed session cookie.
        const isPasswordPath = path === SECURE_PASS_PATH;
        const changingPassword = isPasswordPath && (method === 'PUT' || method === 'PATCH');
        const authReq = changingPassword
          ? { ...req, headers: { ...req.headers, cookie: '' } }
          : req;
        const passOk = await isAdminAuthorized(authReq, req.body);
        if (!passOk && (!IS_LOCAL_DEV || changingPassword)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Handle direct password updates explicitly
        if (isPasswordPath && (method === 'PUT' || method === 'PATCH')) {
            const raw = req.body;
            const nextPass = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? String(raw.adminPassword || '') : '');
            if (!nextPass || nextPass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
            await setAdminPassword(nextPass);
            return res.json({ ok: true });
        }

        // 2) Proxy the request to Firebase with secret auth
        const proxyUrl = `${FB_URL}/${path}.json${secretAuth}`;
        const fetchOpts = { method };

        if (['POST', 'PUT', 'PATCH'].includes(method)) {
            fetchOpts.body = JSON.stringify(req.body);
            fetchOpts.headers = { 'Content-Type': 'application/json' };
        }

        const targetRes = await fetch(proxyUrl, fetchOpts);

        const text = await targetRes.text();
        let targetData = null;
        try { targetData = text ? JSON.parse(text) : null; } catch { targetData = null; }

        return res.json(targetData);
    } catch (e) {
        const message = String(e?.message || 'Internal server error');
        console.error('[admin-proxy] error:', message);
        const publicMessage = message.startsWith('Firebase request failed') ? message : 'Internal server error';
        return res.status(500).json({ error: publicMessage });
    }
};
