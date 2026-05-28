// /api/lead.js — Vercel serverless (Node.js, CommonJS)

const ALLOWED_ORIGINS = new Set([
  'https://magic-school-eight.vercel.app',
  'https://demonnikko.github.io',
  'http://localhost:3000',
  'http://localhost'
]);

// простенький лимитер по IP (на один инстанс)
const bucket = new Map();
const WINDOW_MS = 60 * 1000;
const LIMIT = 8;

function allowOrigin(origin) {
  if (!origin) return '*'; // для прямых запросов (same-origin) либо curl
  return ALLOWED_ORIGINS.has(origin) ? origin : 'https://magic-school-eight.vercel.app';
}

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(origin));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sanitize(s, max = 120) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max);
}

module.exports = async (req, res) => {
  setCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  // rate limit
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const b = bucket.get(ip) || [];
    const recent = b.filter(t => now - t < WINDOW_MS);
    if (recent.length >= LIMIT) {
      return res.status(429).json({ ok: false });
    }
    recent.push(now);
    bucket.set(ip, recent);
  } catch (_) {}

  try {
    // гарантируем JSON
    let body = {};
    if (req.headers['content-type']?.includes('application/json')) {
      body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => {
          data += c;
          if (data.length > 10 * 1024) { // 10KB
            reject(new Error('Payload too large'));
          }
        });
        req.on('end', () => {
          try { resolve(JSON.parse(data || '{}')); }
          catch (e) { reject(e); }
        });
      });
    }

    const hp = String(body.website || '').trim(); // honeypot
    if (hp) return res.status(200).json({ ok: true }); // тихо "успешно"

    const parent = sanitize(body.parent, 60);
    const phone  = sanitize(body.phone, 30);
    const age    = sanitize(body.age, 3);
    const email  = sanitize(body.email, 100);

    if (!parent || !phone) {
      return res.status(400).json({ ok: false });
    }

    // доп. проверки
    if (!/^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(phone)) {
      return res.status(400).json({ ok: false });
    }
    if (age && (isNaN(Number(age)) || Number(age) < 7 || Number(age) > 13)) {
      return res.status(400).json({ ok: false });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false });
    }

    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      // не раскрываем детали наружу
      return res.status(500).json({ ok: false });
    }

    // сборка текста (без опасных символов)
    const text =
`🪄 Заявка на пробный урок
Имя родителя: ${parent}
Телефон: ${phone}
Возраст ребёнка: ${age || '-'}
Email: ${email || '-'}`;

    const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;

    const tgResp = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!tgResp.ok) {
      // если токен неправильный или чат неверный — просто 502 без подробностей
      return res.status(502).json({ ok: false });
    }

    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(500).json({ ok: false });
  }
};
