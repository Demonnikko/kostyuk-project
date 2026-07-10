import {  fbGet, fbPut  } from '../../shared/firebase.js';
import {  setCors  } from '../../shared/cors.js';
import {  getTrustedTelegramUserId  } from '../../shared/tg.js';
import {  runSecretAutoCleanup  } from '../../shared/autoCleanup.js';
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';
const RESERVE_MS = Number(process.env.TEMP_RESERVE_MS || 10 * 60 * 1000);
const MAX_SEATS_MUTATION = 10;
const VKPAY_SECRET_ENABLED = String(process.env.VKPAY_SECRET_ENABLED || process.env.VKPAY_ENABLED || '').trim().toLowerCase() === 'true';
const VKPAY_APP_ID = String(process.env.VKPAY_APP_ID || process.env.VK_APP_ID || '').trim();
const VKPAY_APP_SECURE_KEY = String(process.env.VKPAY_APP_SECURE_KEY || process.env.VK_APP_SECURE_KEY || '').trim();
const VKPAY_MERCHANT_ID = String(process.env.VKPAY_MERCHANT_ID || '').trim();
const VKPAY_MERCHANT_PRIVATE_KEY = String(process.env.VKPAY_MERCHANT_PRIVATE_KEY || '').trim();
const VKPAY_NOTIFY_PUBLIC_KEY = String(process.env.VKPAY_NOTIFY_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();

function isSecretVkPayConfigured() {
  return VKPAY_SECRET_ENABLED
    && VKPAY_APP_ID
    && VKPAY_APP_SECURE_KEY
    && VKPAY_MERCHANT_ID
    && VKPAY_MERCHANT_PRIVATE_KEY
    && VKPAY_NOTIFY_PUBLIC_KEY;
}

function isValidTempBookingId(v) {
  return /^TEMP-[A-Z0-9_-]{6,80}$/i.test(String(v || ''));
}

function normalizeSeat(raw) {
  const tableId = Number(raw?.tableId);
  const seatIdx = Number(raw?.seatIdx);
  if (!Number.isInteger(tableId) || tableId < 1 || tableId > 100) return null;
  if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx > 30) return null;
  return { tableId, seatIdx, key: `${tableId}_${seatIdx}` };
}

async function isSecretSalesPaused() {
  const showCfg = await fbGet('ticket_config/show');
  return Boolean(showCfg && showCfg.salesPaused === true);
}

async function isHuliganSalesPaused() {
  const showCfg = await fbGet('huligan_config/show');
  return Boolean(showCfg && showCfg.salesPaused === true);
}

export default async (req, res) => {
  const corsTargetMethod = String(req.headers?.['access-control-request-method'] || req.method || '').toUpperCase();
  const isPublicRead = corsTargetMethod === 'GET';
  setCors(req, res, { publicRead: isPublicRead, methods: 'GET, POST, OPTIONS' });

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — чтение мест или конфига
  if (req.method === 'GET') {
    await runSecretAutoCleanup().catch(() => {});
    const type = req.query?.type || '';

    // ?type=reviews — публичные отзывы
    if (type === 'reviews') {
      const reviews = await fbGet('ticket_reviews') || {};
      const bookings = await fbGet('ticket_bookings') || {};
      const items = Object.values(reviews)
        .filter(r => r && r.text && r.rating)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20)
        .map(r => {
          const b = bookings[r.bookingId] || {};
          return { rating: r.rating, text: r.text, name: r.name || b.name || 'Гость', createdAt: r.createdAt || null, vkUserId: r.vkUserId || b.vkUserId || null };
        });
      return res.status(200).json(items);
    }

    // ?type=user_bookings — список броней пользователя (Секрет) по tgUserId
    // vkUserId-фолбэк отключён по умолчанию (env ALLOW_VK_USERID_FALLBACK=true).
    if (type === 'user_bookings') {
      const vkUserId = Number(req.query?.vkUserId || 0);
      const trustedTgUserId = Number(getTrustedTelegramUserId(req.query?.tgInitData) || 0);
      const hasVk = ALLOW_VK_USERID_FALLBACK && Number.isFinite(vkUserId) && vkUserId > 0;
      const hasTg = Number.isFinite(trustedTgUserId) && trustedTgUserId > 0;
      if (!hasVk && !hasTg) return res.status(400).json({ error: 'Missing vkUserId/tgInitData' });
      const allBookings = await fbGet('ticket_bookings') || {};
      const items = Object.entries(allBookings)
        .filter(([, b]) => (hasVk && Number(b?.vkUserId) === vkUserId) || (hasTg && Number(b?.tgUserId) === trustedTgUserId))
        .map(([id, b]) => ({
          id,
          status: b.status || '',
          name: b.name || '',
          seats: Array.isArray(b.seats) ? b.seats : [],
          total: Number(b.total || 0),
          discountedTotal: Number(b.discountedTotal || b.total || 0),
          createdAt: b.createdAt || null,
          reviewed: Boolean(b.reviewed)
        }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res.status(200).json(items);
    }

    // ?type=promo — проверка промокода (Секрет)
    if (type === 'promo') {
      const code = String(req.query?.code || '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'Missing code' });
      const promo = await fbGet(`ticket_promo/${code}`);
      if (!promo) return res.status(200).json(null);
      // Возвращаем только публичные поля, без служебных
      return res.status(200).json({
        active: promo.active,
        type: promo.type,
        value: promo.value,
        usesLeft: promo.usesLeft,
        expiresAt: promo.expiresAt || null,
        validFrom: promo.validFrom || null,
        validUntil: promo.validUntil || null,
        description: promo.description || null
      });
    }

    // ?type=config — конфигурация шоу
    if (type === 'config') {
      const section = req.query?.section || '';
      if (section === 'huligan') {
        const hulCfg = await fbGet('huligan_config') || {};
        return res.status(200).json({
          huliganShow: hulCfg.show || null,
          metrics: {
            yandexCounterId: String(process.env.YM_HULIGAN_COUNTER_ID || '').trim()
          }
        });
      }
      const config = await fbGet('ticket_config') || {};
      delete config.adminPassword;
      config.metrics = {
        yandexCounterId: String(process.env.YM_SECRET_COUNTER_ID || '').trim()
      };
      config.vkPay = {
        enabled: Boolean(isSecretVkPayConfigured())
      };
      return res.status(200).json(config);
    }

    // По умолчанию — все места
    const showParam = req.query?.show || 'secret';
    const dbPath = showParam === 'huligan' ? 'huligan_seats' : 'ticket_seats';
    const seats = await fbGet(dbPath) || {};
    return res.status(200).json(seats);
  }

  // POST — временная резервация / освобождение мест (для TEMP-бронирований)
  if (req.method === 'POST') {
    await runSecretAutoCleanup().catch(() => {});
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { }
    }

    const { action, seats, tempBookingId, show = 'secret' } = body || {};
    const dbPath = show === 'huligan' ? 'huligan_seats' : 'ticket_seats';
    const isPaused = show === 'huligan' ? await isHuliganSalesPaused() : await isSecretSalesPaused();

    const trustedTgUserId = Number(getTrustedTelegramUserId(body?.tgInitData) || 0);
    const vkUserId = Number(body?.vkUserId || 0);
    const hasTgAuth = Number.isFinite(trustedTgUserId) && trustedTgUserId > 0;
    const hasVkAuth = ALLOW_VK_USERID_FALLBACK && Number.isFinite(vkUserId) && vkUserId > 0;

    if ((action === 'reserve' || action === 'release') && !hasTgAuth && !hasVkAuth) {
      return res.status(403).json({ error: 'Trusted user identity required' });
    }

    const seatList = Array.isArray(seats) ? seats.map(normalizeSeat).filter(Boolean) : [];
    if ((action === 'reserve' || action === 'release') && (!seatList.length || seatList.length > MAX_SEATS_MUTATION)) {
      return res.status(400).json({ error: 'Invalid seats payload' });
    }

    if (action === 'reserve' && seatList.length && tempBookingId) {
      if (isPaused) {
        return res.status(409).json({ error: 'Продажи на это шоу временно остановлены' });
      }
      if (!isValidTempBookingId(tempBookingId)) return res.status(400).json({ error: 'Only TEMP bookings allowed' });
      const now = Date.now();

      const conflicts = [];
      for (const s of seatList) {
        const cur = await fbGet(`${dbPath}/${s.key}`);
        const status = String(cur?.status || '');
        const curBookingId = String(cur?.bookingId || '');
        const reservedAt = Number(cur?.reservedAt || 0);
        const isFreshReserve = status === 'reserved' && now - reservedAt < RESERVE_MS;
        const occupiedByAnother = curBookingId && curBookingId !== String(tempBookingId);
        if (status === 'taken' || (isFreshReserve && occupiedByAnother)) conflicts.push(s.key);
      }

      if (conflicts.length) return res.status(409).json({ error: 'Seats already taken', seats: conflicts });

      await Promise.all(seatList.map(s =>
        fbPut(`${dbPath}/${s.key}`, {
          status: 'reserved',
          bookingId: tempBookingId,
          reservedAt: now,
          ownerTgUserId: hasTgAuth ? trustedTgUserId : null,
          ownerVkUserId: hasVkAuth ? vkUserId : null
        })
      ));
      return res.status(200).json({ ok: true });
    }

    if (action === 'release' && seatList.length) {
      if (!isValidTempBookingId(tempBookingId)) return res.status(400).json({ error: 'tempBookingId is required' });
      let released = 0;

      for (const s of seatList) {
        const path = `${dbPath}/${s.key}`;
        const cur = await fbGet(path);
        if (!cur) continue;
        if (String(cur.status || '') !== 'reserved') continue;
        if (String(cur.bookingId || '') !== String(tempBookingId)) continue;

        const curOwnerTg = Number(cur.ownerTgUserId || 0);
        const curOwnerVk = Number(cur.ownerVkUserId || 0);
        if (curOwnerTg > 0 && (!hasTgAuth || curOwnerTg !== trustedTgUserId)) continue;
        if (curOwnerVk > 0 && (!hasVkAuth || curOwnerVk !== vkUserId)) continue;

        await fbPut(path, { status: 'available' });
        released++;
      }

      return res.status(200).json({ ok: true, released });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
