import { fbGet, fbPut } from '../../shared/firebase.js';
import { setCors } from '../../shared/cors.js';

const MAX_KEYS = 12;

function normalizeKey(raw) {
  const key = String(raw || '').trim();
  if (!/^([rt]\d+_\d+|d[l|r]_\d+|lampa)$/.test(key)) return null;
  return key;
}

export default async function handler(req, res) {
  setCors(req, res, { publicRead: req.method === 'GET', methods: 'GET, POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const type = req.query?.type || '';
    if (type === 'config') {
      const cfg = await fbGet('matvey_config') || {};
      return res.status(200).json({
        show: cfg.show || null,
        salesPaused: Boolean(cfg.show?.salesPaused),
        metrics: {
          yandexCounterId: String(process.env.YM_MATVEY_COUNTER_ID || '').trim()
        }
      });
    }
    const seats = await fbGet('matvey_seats') || {};
    return res.status(200).json(seats);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const { action, keys, bookingId } = body || {};
    const keyList = Array.isArray(keys) ? keys.map(normalizeKey).filter(Boolean) : [];
    if (!keyList.length || keyList.length > MAX_KEYS) {
      return res.status(400).json({ error: 'Invalid keys' });
    }

    if (action === 'check') {
      const conflicts = [];
      for (const key of keyList) {
        const cur = await fbGet(`matvey_seats/${key}`);
        const st = String(cur?.status || '');
        if (st === 'taken' || st === 'pending' || st === 'reserved') conflicts.push(key);
      }
      if (conflicts.length) return res.status(409).json({ error: 'Seats unavailable', seats: conflicts });
      return res.status(200).json({ ok: true });
    }

    if (action === 'pending' && bookingId) {
      const conflicts = [];
      for (const key of keyList) {
        const cur = await fbGet(`matvey_seats/${key}`);
        const st = String(cur?.status || '');
        if (st === 'taken' || st === 'pending' || st === 'reserved') conflicts.push(key);
      }
      if (conflicts.length) return res.status(409).json({ error: 'Seats unavailable', seats: conflicts });

      const now = Date.now();
      await Promise.all(keyList.map(key =>
        fbPut(`matvey_seats/${key}`, { status: 'pending', bookingId: String(bookingId), at: now })
      ));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
