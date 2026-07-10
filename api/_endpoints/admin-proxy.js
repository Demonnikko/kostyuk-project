const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
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
  'bot_private_config',
  'private_orders',
  'bot_users',
];

function isPathAllowed(path) {
  if (path === SECURE_PASS_PATH) return true;
  return ALLOWED_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'));
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
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Try again in 30 seconds.' });

    const adminPass = readAdminPass(req, req.body);
    const method = req.method;
    const path = String(req.query.path || '').replace(/^\/+/, '');

    if (!adminPass) return res.status(401).json({ error: 'No password' });
    if (!path) return res.status(400).json({ error: 'No path' });
    if (!isPathAllowed(path)) return res.status(403).json({ error: 'Path not allowed' });
    if (!FIREBASE_SECRET) return res.status(500).json({ error: 'FIREBASE_SECRET is not configured' });

    try {
        const secretAuth = `?auth=${FIREBASE_SECRET}`;

        // 1) Verify password
        const storedPass = await getAdminPassword();

        // Bootstrap mode: first password setup
        const isPasswordPath = path === SECURE_PASS_PATH;
        if (!storedPass) {
            const canBootstrap = isPasswordPath && (method === 'PUT' || method === 'PATCH');
            if (!canBootstrap) return res.status(403).json({ error: 'Admin password is not initialized' });
            const raw = req.body;
            const nextPass = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? String(raw.adminPassword || '') : '');
            if (!nextPass || nextPass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
            await setAdminPassword(nextPass);
            return res.json({ ok: true });
        }

        // Проверяем пароль (поддержка и plaintext, и хешей)
        const passOk = await verifyPassword(adminPass, storedPass);
        if (!passOk) return res.status(403).json({ error: 'Forbidden' });

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
        console.error('[admin-proxy] error:', e.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
