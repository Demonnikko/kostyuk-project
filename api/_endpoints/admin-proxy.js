const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';
import { 
  getAdminPassword, setAdminPassword, readAdminPass,
  verifyPassword, isHashedPassword,
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

// ── ЛОКАЛЬНЫЙ обход пароля (только для проверки на localhost) ──
// Работает ТОЛЬКО когда сервер запущен через `vercel dev` (VERCEL_ENV=development)
// или вне Vercel вовсе. На боевом Vercel (VERCEL_ENV=production) — всегда false,
// пароль остаётся обязательным. Даже если этот код задеплоится, дыры нет.
const IS_LOCAL_DEV = process.env.VERCEL_ENV !== 'production';

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
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Try again in 30 seconds.' });

    const adminPass = readAdminPass(req, req.body);
    const method = req.method;
    const path = String(req.query.path || '').replace(/^\/+/, '');

    if (!adminPass && !IS_LOCAL_DEV) return res.status(401).json({ error: 'No password' });
    if (!path) return res.status(400).json({ error: 'No path' });
    if (!isPathAllowed(path)) return res.status(403).json({ error: 'Path not allowed' });
    if (!FIREBASE_SECRET) return res.status(500).json({ error: 'FIREBASE_SECRET is not configured' });

    try {
        const secretAuth = `?auth=${FIREBASE_SECRET}`;

        // 1) Verify password
        const storedPass = await getAdminPassword();

        const isPasswordPath = path === SECURE_PASS_PATH;
        if (!storedPass && !IS_LOCAL_DEV) {
            return res.status(403).json({ error: 'Admin password is not initialized' });
        }

        // Проверяем пароль (поддержка и plaintext, и хешей).
        // Локальный dev: сверку пропускаем — КРОМЕ смены самого пароля (защита от
        // случайной перезаписи боевого пароля через локальную админку).
        const passOk = storedPass ? await verifyPassword(adminPass, storedPass) : false;
        if (!passOk) {
            const changingPassword = isPasswordPath && (method === 'PUT' || method === 'PATCH');
            if (!IS_LOCAL_DEV || changingPassword) {
                return res.status(403).json({ error: 'Forbidden' });
            }
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
