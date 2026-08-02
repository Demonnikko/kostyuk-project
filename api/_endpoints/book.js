/**
 * POST /api/book
 * Создаёт бронирование для мест в зале (шоу "Секрет").
 * Выполняет серверную проверку доступности мест и корректности цен.
 */
import crypto from 'crypto';
const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const TICKET_PUBLIC_ORIGIN = process.env.TICKET_PUBLIC_ORIGIN || 'https://vk-tickets.vercel.app';
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const TELEGRAM_SECRET_WEBAPP_URL = (process.env.TELEGRAM_SECRET_WEBAPP_URL || `${TICKET_PUBLIC_ORIGIN}/index.html`).trim();
const TELEGRAM_ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.ADMIN_TELEGRAM_CHAT_ID || '').trim();
const ADMIN_ID = parseInt(process.env.ADMIN_VK_ID || '196783025', 10) || 196783025;
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';

const BOOKING_ID_RE = /^[A-Z0-9-]{4,30}$/i;
const VALID_ZONES = new Set(['vip', 'standart', 'econom', 'sofa', 'lampa']);
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

function parseIncomingBody(rawBody) {
  if (rawBody == null) return {};
  if (Buffer.isBuffer(rawBody)) {
    return parseIncomingBody(rawBody.toString('utf8'));
  }
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return {};
    try {
      const parsedJson = JSON.parse(trimmed);
      if (parsedJson && typeof parsedJson === 'object') return parsedJson;
    } catch { }
    try {
      const params = new URLSearchParams(trimmed);
      const parsedForm = {};
      for (const [k, v] of params.entries()) parsedForm[k] = v;
      if (Object.keys(parsedForm).length) return parsedForm;
    } catch { }
    return {};
  }
  if (typeof rawBody === 'object') {
    return rawBody;
  }
  return {};
}

const TBANK_TERMINAL_KEY = String(process.env.TBANK_TERMINAL_KEY || '').trim();
const TBANK_TERMINAL_PASSWORD = String(process.env.TBANK_TERMINAL_PASSWORD || '').trim();
const TBANK_TERMINAL_KEY_TEST = String(process.env.TBANK_TERMINAL_KEY_TEST || '').trim();
const TBANK_TERMINAL_PASSWORD_TEST = String(process.env.TBANK_TERMINAL_PASSWORD_TEST || '').trim();
const TBANK_FORCE_TEST_MODE = String(process.env.TBANK_FORCE_TEST_MODE || '').trim().toLowerCase() === 'true';

function shouldUseTBankTestMode() {
  if (TBANK_FORCE_TEST_MODE) return true;
  return Boolean(TBANK_TERMINAL_KEY_TEST && TBANK_TERMINAL_PASSWORD_TEST);
}

function getTBankCredentials() {
  const testMode = shouldUseTBankTestMode();
  const terminalKey = testMode ? TBANK_TERMINAL_KEY_TEST : TBANK_TERMINAL_KEY;
  const password = testMode ? TBANK_TERMINAL_PASSWORD_TEST : TBANK_TERMINAL_PASSWORD;
  return { terminalKey, password, testMode, apiBase: 'https://securepay.tinkoff.ru/v2' };
}

function buildTBankToken(params, password) {
  const payload = { ...params, Password: password };
  delete payload.Token;
  delete payload.Receipt;
  delete payload.Shops;
  delete payload.DATA;
  
  const sortedKeys = Object.keys(payload).sort();
  let valuesStr = '';
  for (const k of sortedKeys) {
    if (typeof payload[k] === 'object') continue;
    valuesStr += String(payload[k]);
  }
  return crypto.createHash('sha256').update(valuesStr).digest('hex');
}

function verifyTBankToken(payload, password) {
  if (!payload || typeof payload !== 'object') return false;
  const received = String(payload.Token || '').trim().toLowerCase();
  const calculated = buildTBankToken(payload, password).toLowerCase();
  if (received.length !== calculated.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(calculated, 'utf8'));
}

async function tbankApi(method, body, creds) {
  const payload = { ...(body || {}), TerminalKey: creds.terminalKey };
  payload.Token = buildTBankToken(payload, creds.password);
  
  const url = `${creds.apiBase}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return { httpOk: false, status: res.status };
    const data = await res.json();
    return { httpOk: true, data };
  } catch (err) {
    return { httpOk: false, error: err.message };
  }
}

async function confirmSecretBooking(bookingId, meta = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: booking, etag } = await fbGetWithETag(`ticket_bookings/${bookingId}`);
    if (!booking) return { ok: false, error: 'Booking not found' };
    if (booking.status === 'confirmed') return { ok: true };

    const now = Date.now();
    const ticketNumber = booking.ticketNumber || `SEC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const updatedBooking = {
      ...booking,
      status: 'confirmed',
      ticketNumber,
      confirmedAt: now,
      paidAt: meta.paidAt || now,
      tbank: {
        ...(booking.tbank || {}),
        status: 'confirmed',
        paidAt: meta.paidAt || now,
        transactionId: meta.transactionId || '',
        provider: meta.provider || 'tbank'
      }
    };

    try {
      const success = await fbConditionalPut(`ticket_bookings/${bookingId}`, updatedBooking, etag);
      if (!success) throw new Error('ETAG_MISMATCH');
      
      const seats = Array.isArray(booking.seats) ? booking.seats : [];
      await Promise.all(seats.map(async s => {
        const seatKey = s.key || `${s.tableId}_${s.seatIdx}`;
        try {
           const { data: seatCur, etag: seatEtag } = await fbGetWithETag(`ticket_seats/${seatKey}`);
           if (seatCur) {
             await fbConditionalPut(`ticket_seats/${seatKey}`, { ...seatCur, status: 'taken', bookingId }, seatEtag);
           }
        } catch(e) {}
      }));
      
      const seatLines = (seats || [])
        .map(s => `• Стол ${s.tableId}, место ${Number(s.seatIdx) + 1} (${String(s.zone || '').toUpperCase()})`)
        .join('\n');
      const adminMsg = [
        '💳 БРОНЬ ОПЛАЧЕНА (T-BANK) — Шоу «СЕКРЕТ»',
        '',
        `Имя: ${booking.name}`,
        `Телефон: ${booking.phone}`,
        `Сумма: ${booking.discountedTotal} ₽`,
        `Билет: ${ticketNumber}`,
        '',
        'Места:',
        seatLines || '—',
        `🆔 Бронь: ${bookingId}`
      ].join('\n');
      
      await saveAdminNotification(adminMsg, 'booking_confirmed', bookingId);
      await notifyAdmin(adminMsg).catch(() => {});

      if (booking.tgUserId) {
        await tgSendTicketReady(booking.tgUserId, bookingId).catch(() => {});
      } else if (booking.vkUserId) {
        const miniAppUrl = `${MINI_APP_BASE}?tab=tickets&bookingId=${encodeURIComponent(bookingId)}#my_tickets/${encodeURIComponent(bookingId)}`;
        await vkSend(Number(booking.vkUserId), `Ваша оплата успешно подтверждена! 🎉\nВот ваш электронный билет: ${miniAppUrl}`);
      }
      
      return { ok: true };
    } catch (err) {
      if (err.message === 'ETAG_MISMATCH') continue;
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'Concurrent modification' };
}

// Официальные цены зон (₽) — источник истины на сервере
const ZONE_PRICES = {
  vip: 1400,
  standart: 1100,
  econom: 800,
  sofa: 4000,
  lampa: 2500
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

import {  setCors  } from '../../shared/cors.js';
import {  isAdminAuthorized  } from '../../shared/adminAuth.js';
import {  buildTicketLink  } from '../../shared/ticketAccess.js';
import {  getTrustedTelegramUserId  } from '../../shared/tg.js';
import {  runSecretAutoCleanup  } from '../../shared/autoCleanup.js';

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
  setCors(req, res, { methods: 'POST, GET, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  await runSecretAutoCleanup().catch(() => {});

  let body = parseIncomingBody(req.body);
  const action = String(body?.action || req.query?.action || '').trim();

  // ── Public config for payment options ──
  if (action === 'get_config') {
    const creds = getTBankCredentials();
    return res.status(200).json({
      mode: 'tbank',
      tbank: {
        enabled: Boolean(creds.terminalKey && creds.password),
        testMode: creds.testMode,
        provider: 'tbank'
      }
    });
  }

  // ── Prepare T-Bank payment link ──
  if (action === 'tbank_init') {
    if (await isSecretSalesPaused()) {
      return res.status(409).json({ error: 'Продажи на шоу «Секрет» временно остановлены' });
    }
    const { bookingId } = body;
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const status = String(booking.status || '').toLowerCase();
    if (status === 'confirmed') return res.status(200).json({ ok: true, alreadyConfirmed: true });

    const amountRub = Number(booking.discountedTotal || 0);
    const amountKopek = Math.round(amountRub * 100);
    const creds = getTBankCredentials();
    if (!creds.terminalKey || !creds.password) {
      return res.status(409).json({ error: 'T-Bank credentials are missing' });
    }

    const initPayload = {
      Amount: amountKopek,
      OrderId: bookingId,
      Description: `Билеты на шоу «Секрет» — Дмитрий Костюк`,
      NotificationURL: `${TICKET_PUBLIC_ORIGIN}/api/book?action=tbank_notify`,
      SuccessURL: `${TICKET_PUBLIC_ORIGIN}/concerts/secret/index.html?pay=success`,
      FailURL: `${TICKET_PUBLIC_ORIGIN}/concerts/secret/index.html?pay=fail`
    };

    const initResult = await tbankApi('Init', initPayload, creds);
    if (!initResult.httpOk || !initResult.data?.Success) {
      return res.status(500).json({ error: initResult.data?.Message || 'T-Bank Init failed' });
    }

    await fbPatch(`ticket_bookings/${bookingId}`, {
      tbank: {
        paymentId: String(initResult.data.PaymentId || ''),
        status: 'Init',
        amount: amountRub
      }
    });

    return res.status(200).json({ ok: true, paymentUrl: initResult.data.PaymentURL });
  }

  // ── Get booking status (with state check) ──
  if (action === 'get_booking') {
    const { bookingId } = body;
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (booking.status !== 'confirmed' && booking.tbank?.paymentId) {
      const creds = getTBankCredentials();
      const stateResult = await tbankApi('GetState', { PaymentId: booking.tbank.paymentId }, creds);
      if (stateResult.httpOk && stateResult.data?.Success) {
        const tStatus = String(stateResult.data.Status).toUpperCase();
        if (tStatus === 'CONFIRMED' || tStatus === 'AUTHORIZED') {
          await confirmSecretBooking(bookingId, { paidAt: Date.now(), provider: 'tbank' });
        }
      }
    }

    const updated = await fbGet(`ticket_bookings/${bookingId}`);
    return res.status(200).json({ ok: true, status: updated.status });
  }

  // ── T-Bank Webhook Notification ──
  if (action === 'tbank_notify') {
    const sendText = (code, text) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(code).send(String(text || ''));
    };
    const creds = getTBankCredentials();
    const payload = body && typeof body === 'object' ? body : {};
    const terminalKey = String(payload.TerminalKey || '').trim();
    const orderId = String(payload.OrderId || '').trim();
    const statusRaw = String(payload.Status || '').toUpperCase();

    if (!orderId) return sendText(400, 'BAD_ORDER');
    if (terminalKey && terminalKey !== creds.terminalKey) {
      return sendText(403, 'BAD_TERMINAL');
    }
    if (!verifyTBankToken(payload, creds.password)) {
      return sendText(403, 'BAD_TOKEN');
    }

    const booking = await fbGet(`ticket_bookings/${orderId}`);
    if (!booking) return sendText(200, 'OK');

    if (statusRaw === 'CONFIRMED' || statusRaw === 'AUTHORIZED') {
      await confirmSecretBooking(orderId, {
        paidAt: Date.now(),
        provider: 'tbank',
        transactionId: payload.PaymentId,
        orderId
      });
    }

    return sendText(200, 'OK');
  }

  // ── Ручное создание билета администратором ──
  if (action === 'admin_create') {
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
    if (s.zone === 'sofa' || s.zone === 'lampa') {
      if (s.key !== 'dl_0' && s.key !== 'dr_0' && s.key !== 'lampa') {
        return res.status(400).json({ error: `Invalid special seat key: ${s.key}` });
      }
      continue;
    }
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
    const seatKey = s.key || `${s.tableId}_${s.seatIdx}`;
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
      fbPatch(`ticket_seats/${s.key || `${s.tableId}_${s.seatIdx}`}`, { bookingId: tempBookingId || null }).catch(() => {})
    )).catch(() => {});
    // Удаляем бронь
    await fetch(`${FB_URL}/ticket_bookings/${bookingId}.json${FIREBASE_SECRET}`, { method: 'DELETE' }).catch(() => {});
    return res.status(500).json({ error: 'Booking failed, please try again' });
  }
};
