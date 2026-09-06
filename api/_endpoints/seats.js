import {  fbGet, fbPut, fbGetWithETag, fbConditionalPut  } from '../../shared/firebase.js';
import {  setCors  } from '../../shared/cors.js';
import {  getTrustedTelegramUserId  } from '../../shared/tg.js';
import {  runSecretAutoCleanup  } from '../../shared/autoCleanup.js';
import { checkPromoSeatRules, promoSeatsFromQuery } from '../../shared/promoRules.js';
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';
const RESERVE_MS = Number(process.env.TEMP_RESERVE_MS || 10 * 60 * 1000);
const MAX_SEATS_MUTATION = 10;

function isValidTempBookingId(v) {
  return /^TEMP-[A-Z0-9_-]{6,80}$/i.test(String(v || ''));
}

const SPECIAL_SEAT_KEYS = new Set([
  'sl_0', 'sr_0', 'bar_0', 'dl_0', 'dr_0', 'lampa',
  'dl_1', 'dl_2', 'dl_3', 'dl_4', 'dl_5',
  'dr_6', 'dr_7', 'dr_8', 'dr_9', 'dr_10',
  'bar_1', 'bar_2', 'bar_3'
]);

function normalizeSeat(raw) {
  const key = String(raw?.key || '').trim();
  if (SPECIAL_SEAT_KEYS.has(key)) {
    return { tableId: 0, seatIdx: 0, key };
  }
  const tableId = Number(raw?.tableId);
  const seatIdx = Number(raw?.seatIdx);
  if (!Number.isInteger(tableId) || tableId < 1 || tableId > 100) return null;
  if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx > 100) return null;
  // ВАЖНО: клиент формирует ключ как 't{tableId}_{seatIdx}' (напр. t19_93).
  // Сохраняем именно его — иначе резервация (seats.js) писала бы '19_93',
  // а покупка (book.js по s.key) — 't19_93', создавая ДВЕ записи одного места
  // и позволяя продать его дважды. Ключ строго валидируем от Firebase-инъекции.
  if (/^t\d{1,3}_\d{1,4}$/.test(key)) return { tableId, seatIdx, key };
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

    // ?type=reviews — публичные отзывы (по шоу: secret по умолчанию, huligan/matvey)
    if (type === 'reviews') {
      const showParam = req.query?.section || req.query?.show || 'secret';
      const node = showParam === 'huligan' ? 'huligan_reviews'
        : showParam === 'matvey' ? 'matvey_reviews' : 'ticket_reviews';
      const bookingsNode = showParam === 'huligan' ? 'huligan_bookings'
        : showParam === 'matvey' ? 'matvey_bookings' : 'ticket_bookings';
      const reviews = await fbGet(node) || {};
      const bookings = await fbGet(bookingsNode) || {};
      const items = Object.values(reviews)
        .filter(r => r && r.text && r.rating)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20)
        .map(r => {
          const b = bookings[r.bookingId] || {};
          return { rating: r.rating, text: r.text, name: r.name || b.name || 'Гость', createdAt: r.createdAt || null };
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
      const nowTs = Date.now();
      const seatRule = checkPromoSeatRules(promo, promoSeatsFromQuery(req.query?.seats));
      const activeNow = Boolean(promo.active === true
        && (!promo.expiresAt || nowTs <= Number(promo.expiresAt))
        && (!promo.validFrom || nowTs >= Number(promo.validFrom))
        && (!promo.validUntil || nowTs <= Number(promo.validUntil))
        && (promo.usesLeft == null || promo.usesLeft === -1 || Number(promo.usesLeft) > 0)
        && seatRule.ok);
      // Возвращаем только публичные поля, без служебных
      return res.status(200).json({
        active: activeNow,
        type: promo.type,
        value: promo.value,
        usesLeft: promo.usesLeft,
        expiresAt: promo.expiresAt || null,
        validFrom: promo.validFrom || null,
        validUntil: promo.validUntil || null,
        description: promo.description || null,
        restrictionReason: seatRule.ok ? null : seatRule.reason
      });
    }

    // ?type=config — конфигурация шоу
    if (type === 'config') {
      const section = req.query?.section || '';
      if (section === 'huligan') {
        const hulCfg = await fbGet('huligan_config') || {};
        return res.status(200).json({
          huliganShow: hulCfg.show || null,
          prices: hulCfg.prices || null,
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
      if (!tempBookingId || !isValidTempBookingId(tempBookingId)) {
        return res.status(403).json({ error: 'Trusted user identity or valid tempBookingId required' });
      }
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
      const seatUpdates = [];
      for (const s of seatList) {
        const { data: cur, etag } = await fbGetWithETag(`${dbPath}/${s.key}`);
        const status = String(cur?.status || '');
        const curBookingId = String(cur?.bookingId || '');
        const reservedAt = Number(cur?.reservedAt || 0);
        const isFreshReserve = status === 'reserved' && now - reservedAt < RESERVE_MS;
        const occupiedByAnother = curBookingId && curBookingId !== String(tempBookingId);
        if (status === 'taken' || (isFreshReserve && occupiedByAnother)) {
          conflicts.push(s.key);
        } else {
          seatUpdates.push({ key: s.key, etag });
        }
      }

      if (conflicts.length) return res.status(409).json({ error: 'Seats already taken', seats: conflicts });

      try {
        await Promise.all(seatUpdates.map(s =>
          fbConditionalPut(`${dbPath}/${s.key}`, {
            status: 'reserved',
            bookingId: tempBookingId,
            reservedAt: now,
            ownerTgUserId: hasTgAuth ? trustedTgUserId : null,
            ownerVkUserId: hasVkAuth ? vkUserId : null
          }, s.etag)
        ));
      } catch (e) {
        if (e.message === 'ETAG_MISMATCH') {
          return res.status(409).json({ error: 'Concurrent modification detected, please try again' });
        }
        throw e;
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'release' && seatList.length) {
      if (!isValidTempBookingId(tempBookingId)) return res.status(400).json({ error: 'tempBookingId is required' });
      let released = 0;

      for (const s of seatList) {
        const path = `${dbPath}/${s.key}`;
        const { data: cur, etag } = await fbGetWithETag(path);
        if (!cur) continue;
        if (String(cur.status || '') !== 'reserved') continue;
        if (String(cur.bookingId || '') !== String(tempBookingId)) continue;

        const curOwnerTg = Number(cur.ownerTgUserId || 0);
        const curOwnerVk = Number(cur.ownerVkUserId || 0);
        if (curOwnerTg > 0 && (!hasTgAuth || curOwnerTg !== trustedTgUserId)) continue;
        if (curOwnerVk > 0 && (!hasVkAuth || curOwnerVk !== vkUserId)) continue;

        try {
          await fbConditionalPut(path, { status: 'available' }, etag);
          released++;
        } catch(e) {
          // Ignore ETAG mismatch on release, it means it's already modified
        }
      }

      return res.status(200).json({ ok: true, released });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
