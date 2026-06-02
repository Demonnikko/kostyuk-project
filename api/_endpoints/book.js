/**
 * POST /api/book
 * Создаёт бронирование для мест в зале (шоу "Секрет").
 * Выполняет серверную проверку доступности мест и корректности цен.
 */
import crypto from 'crypto';
const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const TICKET_PUBLIC_ORIGIN = process.env.TICKET_PUBLIC_ORIGIN || 'https://vk-tickets.vercel.app';
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const TELEGRAM_SECRET_WEBAPP_URL = (process.env.TELEGRAM_SECRET_WEBAPP_URL || `${TICKET_PUBLIC_ORIGIN}/index.html`).trim();
const TELEGRAM_ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.ADMIN_TELEGRAM_CHAT_ID || '').trim();
const ADMIN_ID = parseInt(process.env.ADMIN_VK_ID || '196783025', 10) || 196783025;
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';

const BOOKING_ID_RE = /^[A-Z0-9-]{4,30}$/i;
const VALID_ZONES = new Set(['vip', 'standart', 'econom']);
const MAX_SEATS_PER_BOOKING = 10;
const NAME_MAX = 100;
const PHONE_MIN_DIGITS = 10;

function randomFromAlphabet(length, alphabet) {
  let out = '';
  const max = alphabet.length;
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(0, max)];
  return out;
}

function genAdminBookingId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const tail = randomFromAlphabet(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  return `BK-ADM-${stamp}${tail}`;
}

// Официальные цены зон (₽) — источник истины на сервере
const ZONE_PRICES = {
  vip: 1400,
  standart: 1100,
  econom: 800
};

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// GET с ETag для conditional writes (защита от race condition)
async function fbGetWithETag(path) {
  const sep = FIREBASE_SECRET ? '&' : '?';
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}${sep}X-Firebase-ETag=true`, {
    headers: { 'X-Firebase-ETag': 'true' }
  });
  if (!r.ok) return { data: null, etag: null };
  const data = await r.json();
  const etag = r.headers.get('etag');
  return { data, etag };
}

// Conditional PUT — записывает только если данные не менялись с момента чтения
// Возвращает true если запись успешна, false при конфликте (412)
async function fbConditionalPut(path, data, etag) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'if-match': etag
    },
    body: JSON.stringify(data)
  });
  if (r.status === 412) return false; // Conflict — data changed
  if (!r.ok) throw new Error(`Firebase PUT failed: ${r.status}`);
  return true;
}

async function fbPut(path, data) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Firebase PUT failed: ${r.status}`);
}

async function fbPatch(path, data) {
  await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

import {  setCors  } from '../_lib/cors';
import {  isAdminAuthorized  } from '../_lib/adminAuth';
import {  buildTicketLink  } from '../_lib/ticketAccess';
import {  getTrustedTelegramUserId  } from '../_lib/tg';
import {  runSecretAutoCleanup  } from '../_lib/autoCleanup';

const VK_TOKEN = (process.env.VK_TOKEN || '').trim();
const MINI_APP_BASE = process.env.VK_TICKETS_MINI_APP_URL || 'https://vk.com/app54466228_-209268664';
async function vkSend(userId, text) {
  if (!VK_TOKEN) return;
  const params = new URLSearchParams({ peer_id: userId, message: text, random_id: crypto.randomInt(1, 2_000_000_000), access_token: VK_TOKEN, v: '5.199' });
  await fetch('https://api.vk.com/method/messages.send', { method: 'POST', body: params }).catch(() => {});
}

async function tgSend(chatId, text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false };
  try {
    const payload = {
      chat_id: String(chatId),
      text: String(text),
      disable_web_page_preview: true
    };
    if (opts.reply_markup) payload.reply_markup = opts.reply_markup;
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

async function notifyAdmin(text) {
  const jobs = [];
  if (VK_TOKEN && Number.isFinite(ADMIN_ID) && ADMIN_ID > 0) {
    jobs.push(vkSend(ADMIN_ID, text).catch(() => {}));
  }
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
    jobs.push(tgSend(TELEGRAM_ADMIN_CHAT_ID, text).catch(() => ({ ok: false })));
  }
  if (!jobs.length) return [];
  return Promise.all(jobs);
}

async function saveAdminNotification(text, event, bookingId) {
  try {
    const key = `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    await fbPut(`admin_notifications/${key}`, {
      text: String(text || ''),
      event: String(event || ''),
      bookingId: bookingId ? String(bookingId) : null,
      ts: Date.now(),
      read: false
    });
  } catch {}
}

async function isSecretSalesPaused() {
  const showCfg = await fbGet('ticket_config/show');
  return Boolean(showCfg && showCfg.salesPaused === true);
}

function buildSecretTelegramTicketLink(bookingId = '') {
  try {
    const url = new URL(TELEGRAM_SECRET_WEBAPP_URL);
    if (bookingId) {
      url.searchParams.set('tab', 'tickets');
      url.searchParams.set('bookingId', String(bookingId));
    }
    return url.toString();
  } catch {
    const hasQuery = TELEGRAM_SECRET_WEBAPP_URL.includes('?');
    if (!bookingId) return TELEGRAM_SECRET_WEBAPP_URL;
    return `${TELEGRAM_SECRET_WEBAPP_URL}${hasQuery ? '&' : '?'}tab=tickets&bookingId=${encodeURIComponent(String(bookingId))}`;
  }
}

async function tgSendTicketReady(chatId, bookingId) {
  const tgLink = buildSecretTelegramTicketLink(bookingId);
  const primary = await tgSend(chatId, 'Поздравляю с приобретением билета.\nСекрет ближе, чем тебе кажется 👇', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🎟 Мой билет', web_app: { url: tgLink } }
      ]]
    }
  }).catch(() => ({ ok: false }));
  if (primary && primary.ok) return primary;
  return tgSend(chatId, `Поздравляю с приобретением билета.\nСекрет ближе, чем тебе кажется 👇\nВот твой билет: ${tgLink}`);
}

export default async (req, res) => {
  setCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  await runSecretAutoCleanup().catch(() => {});

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }

  // ── Ручное создание билета администратором ──
  if (body?.action === 'admin_create') {
    if (!(await isAdminAuthorized(req, body))) return res.status(403).json({ error: 'Forbidden' });
    const {
      name,
      phone,
      seats,
      finalPrice,
      vkUserId: recipientVkId,
      tgUserId: recipientTgId,
      tgUsername: recipientTgUsername,
      sendNotification
    } = body;
    if (!name || !Array.isArray(seats) || seats.length === 0) return res.status(400).json({ error: 'name and seats are required' });
    const cleanName = String(name).trim();
    const digits = String(phone || '').replace(/\D/g, '');
    const now = Date.now();
    const newBookingId = genAdminBookingId();
    const clientKey = crypto.randomBytes(24).toString('hex');
    const total = seats.reduce((sum, s) => sum + (ZONE_PRICES[s.zone] || 0), 0);
    const discountedTotal = finalPrice != null ? Number(finalPrice) : total;
    const tgId = Number.isFinite(Number(recipientTgId)) && Number(recipientTgId) > 0 ? Number(recipientTgId) : null;
    const tgUsernameRaw = String(recipientTgUsername || '').trim().replace(/\s+/g, '');
    const tgUsername = /^@?[a-zA-Z0-9_]{3,64}$/.test(tgUsernameRaw)
      ? tgUsernameRaw.replace(/^@/, '')
      : null;
    try {
      await fbPut(`ticket_bookings/${newBookingId}`, {
        name: cleanName, phone: digits, seats, total, discountedTotal,
        status: 'confirmed', clientKey, createdAt: now, confirmedAt: now,
        adminCreated: true, ticketLinkVersion: 1,
        vkUserId: Number.isFinite(Number(recipientVkId)) && Number(recipientVkId) > 0 ? Number(recipientVkId) : null,
        tgUserId: tgId,
        tgUsername
      });
      // Помечаем места как занятые
      await Promise.all(seats.map(s => fbPut(`ticket_seats/${s.tableId}_${s.seatIdx}`, { status: 'taken', bookingId: newBookingId })));
      // Генерируем HMAC-ссылку на билет
      const bookingForLink = { ticketLinkVersion: 1 };
      const { url: ticketUrl } = await buildTicketLink(newBookingId, bookingForLink);
      // Уведомляем пользователя в ВК — только ссылка на мини-апп
      if (recipientVkId && sendNotification !== false) {
        const miniAppUrl = `${MINI_APP_BASE}?tab=tickets&bookingId=${encodeURIComponent(newBookingId)}#my_tickets/${encodeURIComponent(newBookingId)}`;
        await vkSend(Number(recipientVkId), `Поздравляю с приобретением билета.\nСекрет ближе, чем тебе кажется 👇\nВот твой билет: ${miniAppUrl}`);
      }
      let notificationWarning = null;
      if (tgId && sendNotification !== false) {
        await tgSendTicketReady(tgId, newBookingId).catch(() => { });
      } else if (tgUsername && sendNotification !== false) {
        notificationWarning = 'Указан только @username. Telegram не позволяет отправить сообщение без chat_id (tgUserId).';
      }
      return res.status(200).json({ ok: true, bookingId: newBookingId, clientKey, ticketUrl, notificationWarning });
    } catch (err) {
      return res.status(500).json({ error: 'Create failed' });
    }
  }

  const { bookingId, name, phone, seats, tempBookingId, promoCode, vkUserId } = body || {};
  const trustedTgUserId = getTrustedTelegramUserId(body?.tgInitData);

  if (await isSecretSalesPaused()) {
    return res.status(409).json({ error: 'Продажи на шоу «Секрет» временно остановлены' });
  }

  // ── Валидация входных данных ──────────────────────────────
  if (!bookingId || !BOOKING_ID_RE.test(String(bookingId)))
    return res.status(400).json({ error: 'Invalid bookingId' });

  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > NAME_MAX)
    return res.status(400).json({ error: 'Invalid name' });

  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < PHONE_MIN_DIGITS)
    return res.status(400).json({ error: 'Invalid phone' });

  if (!Array.isArray(seats) || seats.length === 0 || seats.length > MAX_SEATS_PER_BOOKING)
    return res.status(400).json({ error: 'Invalid seats' });

  for (const s of seats) {
    if (!Number.isInteger(s.tableId) || s.tableId < 1 || s.tableId > 50)
      return res.status(400).json({ error: 'Invalid seat tableId' });
    if (!Number.isInteger(s.seatIdx) || s.seatIdx < 0 || s.seatIdx > 20)
      return res.status(400).json({ error: 'Invalid seat index' });
    if (!VALID_ZONES.has(String(s.zone)))
      return res.status(400).json({ error: `Invalid zone: ${s.zone}` });
  }

  // ── Проверяем что booking с таким ID ещё не существует ────
  const existingBooking = await fbGet(`ticket_bookings/${bookingId}`);
  if (existingBooking) return res.status(409).json({ error: 'Booking already exists' });

  // ── Серверная проверка доступности мест ───────────────────
  const RESERVE_MS = 10 * 60 * 1000; // 10 минут
  const now = Date.now();
  const takenSeats = [];
  const seatSnapshots = []; // Сохраняем ETag для атомарного резервирования

  for (const s of seats) {
    const seatKey = `${s.tableId}_${s.seatIdx}`;
    const { data: seatData, etag } = await fbGetWithETag(`ticket_seats/${seatKey}`);
    seatSnapshots.push({ seat: s, seatKey, seatData, etag });

    if (!seatData) continue; // Нет записи = свободно

    const status = String(seatData.status || '');
    const seatBookingId = String(seatData.bookingId || '');

    // Место занято если: 'taken' или 'reserved' для другой брони и ещё не истёк таймер
    if (status === 'taken') {
      takenSeats.push(seatKey);
    } else if (status === 'reserved' && seatBookingId !== tempBookingId) {
      const reservedAt = Number(seatData.reservedAt || 0);
      if (now - reservedAt < RESERVE_MS) {
        takenSeats.push(seatKey);
      }
    }
  }

  if (takenSeats.length > 0) {
    return res.status(409).json({ error: 'Seats already taken', seats: takenSeats });
  }

  // ── Расчёт цены на сервере (клиенту не доверяем) ──────────
  let promoData = null;
  if (promoCode) {
    const code = String(promoCode).trim().toUpperCase();
    const promo = await fbGet(`ticket_promo/${code}`);
    const nowTs = Date.now();
    const notExpired = !promo?.expiresAt || nowTs <= promo.expiresAt;
    const notTooEarly = !promo?.validFrom || nowTs >= promo.validFrom;
    const hasUses = promo?.usesLeft == null || promo.usesLeft === -1 || promo.usesLeft > 0;
    if (promo && promo.active === true && notExpired && notTooEarly && hasUses) {
      promoData = { code, type: promo.type, value: Number(promo.value || 0) };
    }
  }

  const total = seats.reduce((sum, s) => sum + (ZONE_PRICES[s.zone] || 0), 0);
  let discountedTotal = total;
  if (promoData) {
    if (promoData.type === 'free') discountedTotal = 0;
    else if (promoData.type === 'percent') discountedTotal = Math.round(total * (1 - promoData.value / 100));
    else if (promoData.type === 'fixed') discountedTotal = Math.max(0, total - promoData.value);
  }

  // ── Создаём бронирование ───────────────────────────────────
  try {
    // Генерируем clientKey — секретный ключ для доступа к брони
    const clientKey = crypto.randomBytes(24).toString('hex');

    const booking = {
      name: cleanName,
      phone: digits,
      seats,
      total,
      discountedTotal,
      promoCode: promoData ? promoData.code : null,
      status: 'pending_payment',
      createdAt: now,
      clientKey,
      ticketLinkVersion: 1,
      vkUserId: ALLOW_VK_USERID_FALLBACK && Number.isFinite(Number(vkUserId)) && Number(vkUserId) > 0 ? Number(vkUserId) : null,
      tgUserId: Number.isFinite(Number(trustedTgUserId)) && Number(trustedTgUserId) > 0 ? Number(trustedTgUserId) : null
    };

    await fbPut(`ticket_bookings/${bookingId}`, booking);

    // Атомарное резервирование мест с conditional write (ETag)
    // Если место изменилось между проверкой и записью — откатываем
    const reservedKeys = [];
    let conflictKey = null;

    for (const snap of seatSnapshots) {
      const seatPath = `ticket_seats/${snap.seatKey}`;
      const newData = {
        ...(snap.seatData || {}),
        bookingId,
        status: 'reserved',
        reservedAt: now
      };

      if (snap.etag) {
        const ok = await fbConditionalPut(seatPath, newData, snap.etag);
        if (!ok) { conflictKey = snap.seatKey; break; }
      } else {
        // Нового места не существовало — просто пишем
        await fbPut(seatPath, newData);
      }
      reservedKeys.push(snap.seatKey);
    }

    // При конфликте — откатываем все уже зарезервированные места и бронь
    if (conflictKey) {
      await Promise.all(reservedKeys.map(key =>
        fbPatch(`ticket_seats/${key}`, { bookingId: tempBookingId || null, status: tempBookingId ? 'reserved' : null }).catch(() => {})
      ));
      // Удаляем созданную бронь
      await fetch(`${FB_URL}/ticket_bookings/${bookingId}.json${FIREBASE_SECRET}`, { method: 'DELETE' }).catch(() => {});
      return res.status(409).json({ error: 'Seats already taken', seats: [conflictKey] });
    }

    // Атомарное списание промокода с проверкой через ETag
    if (promoData) {
      const { data: p, etag: promoEtag } = await fbGetWithETag(`ticket_promo/${promoData.code}`);
      if (p && p.usesLeft !== -1 && p.usesLeft > 0 && promoEtag) {
        const updated = { ...p, usesLeft: p.usesLeft - 1 };
        await fbConditionalPut(`ticket_promo/${promoData.code}`, updated, promoEtag);
      }
    }

    // Уведомляем админа уже на этапе создания брони (до кнопки "Я оплатил"),
    // чтобы видеть весь входящий поток в реальном времени.
    const vkRef = booking.vkUserId ? `https://vk.com/id${booking.vkUserId}` : '—';
    const tgRef = booking.tgUserId ? `tg://user?id=${booking.tgUserId}` : '—';
    const seatLines = (seats || [])
      .map(s => `• Стол ${s.tableId}, место ${Number(s.seatIdx) + 1} (${String(s.zone || '').toUpperCase()})`)
      .join('\n');
    const adminMsg = [
      '🆕 Новая бронь создана — Шоу «СЕКРЕТ»',
      '',
      `Имя: ${cleanName}`,
      `Телефон: ${digits}`,
      `👤 VK: ${vkRef}`,
      `💬 TG: ${tgRef}`,
      '',
      'Места:',
      seatLines || '—',
      '',
      `Сумма: ${discountedTotal} ₽`,
      promoData ? `Промокод: ${promoData.code}` : null,
      `🆔 Бронь: ${bookingId}`,
      '',
      '⏳ Ожидает оплату (автоотмена через 10 минут).'
    ].filter(Boolean).join('\n');
    await saveAdminNotification(adminMsg, 'booking_created', bookingId);
    await notifyAdmin(adminMsg).catch(() => {});

    return res.status(200).json({ ok: true, bookingId, clientKey, total, discountedTotal });
  } catch (err) {
    // Откатываем: освобождаем места если они были зарезервированы
    await Promise.all(seats.map(s =>
      fbPatch(`ticket_seats/${s.tableId}_${s.seatIdx}`, { bookingId: tempBookingId || null }).catch(() => {})
    )).catch(() => {});
    // Удаляем бронь
    await fetch(`${FB_URL}/ticket_bookings/${bookingId}.json${FIREBASE_SECRET}`, { method: 'DELETE' }).catch(() => {});
    return res.status(500).json({ error: 'Booking failed, please try again' });
  }
};
