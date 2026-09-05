/**
 * POST/GET /api/matvey
 * Онлайн-покупка билетов на детский квест «Спасти Матвея» с оплатой T-Bank.
 * Схема повторяет «Секрет» (book.js): создание брони с серверным расчётом
 * цены → tbank_init → вебхук tbank_notify → confirmMatveyBooking → билет + письмо.
 *
 * Данные: matvey_bookings/{id}, matvey_seats/{key}, matvey_config/{show,prices}.
 * Места: ключи r{ряд}_{место} | t{стол}_{место} | dl_/dr_ | lampa; зоны
 * row_front / row_back / table / sofa / lampa.
 */
import crypto from 'crypto';
import https from 'https';
import { RUSSIAN_CA_BUNDLE } from '../../shared/russianCaBundle.js';
import { fbGet, fbPut, fbPatch, fbGetWithETag, fbConditionalPut, FB_URL, FIREBASE_SECRET } from '../../shared/firebase.js';
import { setCors } from '../../shared/cors.js';
import { buildTicketLink } from '../../shared/ticketAccess.js';
import { sendEmail, buildTicketEmailHtml } from '../../shared/email.js';
import { renderTicketImage } from '../../shared/ticketImage.js';
import { runMatveyAutoCleanup } from '../../shared/autoCleanup.js';
import { isAdminAuthorized } from '../../shared/adminAuth.js';

const TICKET_PUBLIC_ORIGIN = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.TICKET_PUBLIC_ORIGIN || 'https://kostyuk-project.vercel.app');

const BOOKING_ID_RE = /^[A-Z0-9-]{4,40}$/i;
const SEAT_KEY_RE = /^([rt]\d+_\d+|d[lr]_\d+|lampa)$/;
const MAX_SEATS = 12;
const NAME_MAX = 100;
const PHONE_MIN_DIGITS = 10;
const RESERVE_MS = 10 * 60 * 1000;
const BLOCKED_STATUSES = new Set(['cancelled', 'refunded', 'returned', 'deleted']);

// securepay.tinkoff.ru использует сертификат «Минцифры России», которого нет
// в стандартном доверенном хранилище Node — без явного CA fetch падает.
const tbankHttpsAgent = new https.Agent({ ca: RUSSIAN_CA_BUNDLE });

const TBANK_TERMINAL_KEY = String(process.env.TBANK_TERMINAL_KEY || '').trim();
const TBANK_TERMINAL_PASSWORD = String(process.env.TBANK_TERMINAL_PASSWORD || '').trim();
const TBANK_TERMINAL_KEY_TEST = String(process.env.TBANK_TERMINAL_KEY_TEST || '').trim();
const TBANK_TERMINAL_PASSWORD_TEST = String(process.env.TBANK_TERMINAL_PASSWORD_TEST || '').trim();
const TBANK_FORCE_TEST_MODE = String(process.env.TBANK_FORCE_TEST_MODE || '').trim().toLowerCase() === 'true';
const TBANK_MATVEY_ENABLED = String(process.env.TBANK_MATVEY_ENABLED || 'true').trim().toLowerCase() !== 'false';

const ZONE_PRICES_FALLBACK = { row_front: 1700, row_back: 1400, table: 1100, sofa: 1700, lampa: 1700 };
const ZONE_LABELS = { row_front: 'Красная зона', row_back: 'Зелёная зона', table: 'Синяя зона', sofa: 'Красная зона', lampa: 'Лампа' };

function shouldUseTBankTestMode() {
  if (TBANK_FORCE_TEST_MODE) return true;
  return Boolean(TBANK_TERMINAL_KEY_TEST && TBANK_TERMINAL_PASSWORD_TEST);
}

function getTBankCredentials() {
  const testMode = shouldUseTBankTestMode();
  return {
    terminalKey: testMode ? TBANK_TERMINAL_KEY_TEST : TBANK_TERMINAL_KEY,
    password: testMode ? TBANK_TERMINAL_PASSWORD_TEST : TBANK_TERMINAL_PASSWORD,
    testMode,
    apiBase: 'https://securepay.tinkoff.ru/v2'
  };
}

function buildTBankToken(params, password) {
  const payload = { ...params, Password: password };
  delete payload.Token; delete payload.Receipt; delete payload.Shops; delete payload.DATA;
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

function tbankHttpsPost(url, payload) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      agent: tbankHttpsAgent
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve({ httpOk: false, status: res.statusCode });
        try { resolve({ httpOk: true, data: JSON.parse(raw) }); }
        catch { resolve({ httpOk: false, error: 'Invalid JSON from T-Bank' }); }
      });
    });
    req.on('error', (err) => {
      console.error('[matvey tbankApi] request error:', err.message, 'cause:', err.cause);
      resolve({ httpOk: false, error: err.message });
    });
    req.write(bodyStr);
    req.end();
  });
}

async function tbankApi(method, body, creds) {
  const payload = { ...(body || {}), TerminalKey: creds.terminalKey };
  payload.Token = buildTBankToken(payload, creds.password);
  return tbankHttpsPost(`${creds.apiBase}/${method}`, payload);
}

function parseIncomingBody(rawBody) {
  if (rawBody == null) return {};
  if (Buffer.isBuffer(rawBody)) return parseIncomingBody(rawBody.toString('utf8'));
  if (typeof rawBody === 'string') {
    const t = rawBody.trim();
    if (!t) return {};
    try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch {}
    return {};
  }
  if (typeof rawBody === 'object') return rawBody;
  return {};
}

async function getZonePrices() {
  try {
    const cfg = await fbGet('matvey_config/prices');
    if (!cfg || typeof cfg !== 'object') return { ...ZONE_PRICES_FALLBACK };
    const merged = { ...ZONE_PRICES_FALLBACK };
    for (const zone of Object.keys(ZONE_PRICES_FALLBACK)) {
      const v = Number(cfg[zone]);
      if (Number.isFinite(v) && v >= 0) merged[zone] = v;
    }
    return merged;
  } catch { return { ...ZONE_PRICES_FALLBACK }; }
}

async function isMatveySalesPaused() {
  const showCfg = await fbGet('matvey_config/show');
  return Boolean(showCfg && showCfg.salesPaused === true);
}

function seatLabel(s) {
  if (s.label) return String(s.label);
  const key = String(s.key || '');
  if (key === 'lampa') return 'Зона Лампа';
  if (key.startsWith('dl_')) return 'Левый диван';
  if (key.startsWith('dr_')) return 'Правый диван';
  const m = key.match(/^r(\d+)_(\d+)$/);
  if (m) return `Ряд ${m[1]}, место ${m[2]}`;
  const t = key.match(/^t(\d+)_(\d+)$/);
  if (t) return `Стол ${t[1]}, место ${t[2]}`;
  return key;
}

function genTicketNumber() {
  return `MTV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// Подтверждение брони — единственное место, где статус становится confirmed.
// Используется вебхуком tbank_notify и фолбэком get_booking (GetState).
async function confirmMatveyBooking(bookingId, meta = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: booking, etag } = await fbGetWithETag(`matvey_bookings/${bookingId}`);
    if (!booking) return { ok: false, error: 'Booking not found' };
    if (String(booking.status || '').toLowerCase() === 'confirmed') return { ok: true };

    const now = Date.now();
    const ticketNumber = booking.ticketNumber || genTicketNumber();
    const updated = {
      ...booking,
      status: 'confirmed',
      ticketNumber,
      confirmedAt: now,
      paidAt: meta.paidAt || now,
      tbank: { ...(booking.tbank || {}), status: 'confirmed', paidAt: meta.paidAt || now, transactionId: meta.transactionId || '', provider: 'tbank' }
    };

    try {
      const ok = await fbConditionalPut(`matvey_bookings/${bookingId}`, updated, etag);
      if (!ok) throw new Error('ETAG_MISMATCH');

      const seats = Array.isArray(booking.seats) ? booking.seats : [];
      await Promise.all(seats.map(async s => {
        const key = s.key;
        if (!key) return;
        try {
          const { data: cur, etag: se } = await fbGetWithETag(`matvey_seats/${key}`);
          if (cur) await fbConditionalPut(`matvey_seats/${key}`, { ...cur, status: 'taken', bookingId }, se);
          else await fbPut(`matvey_seats/${key}`, { status: 'taken', bookingId });
        } catch {}
      }));

      if (booking.email) {
        try {
          const { url: ticketUrl } = await buildTicketLinkMatvey(bookingId, updated);
          const seatsReadable = seats.map(seatLabel).join(', ');
          const [dPart, tPart] = String(booking.eventDate || '').split(/\s+(?=\d{1,2}:\d{2}$)/);
          const html = buildTicketEmailHtml({
            name: booking.name, showLabel: 'Спасти Матвея',
            dateLabel: booking.eventDate || '—', seatsLabel: seatsReadable || '—', ticketUrl
          });
          const img = await renderTicketImage('matvey', {
            name: booking.name,
            seatsLabel: seatsReadable || '—',
            dateLabel: dPart || booking.eventDate || '—',
            timeLabel: tPart || '',
            venue: 'Арт-площадка «Лампа»',
            ticketsCount: seats.length,
            amountLabel: `${Number(booking.discountedTotal || booking.total || 0)} ₽`,
            bookingId, ticketUrl
          });
          await sendEmail({
            to: booking.email, subject: 'Ваш билет на «Спасти Матвея»', html,
            attachments: img ? [{ filename: `ticket-${bookingId}.png`, content: img }] : undefined
          });
        } catch {}
      }
      return { ok: true };
    } catch (err) {
      if (err.message === 'ETAG_MISMATCH') continue;
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'Concurrent modification' };
}

// Матвей хранит брони в matvey_bookings, а shared ticketAccess.buildTicketLink
// работает с ticket_bookings — поэтому свой билет-токен через ту же HMAC-схему,
// но с показом matvey (страница matvey-ticket.html проверяет через свой endpoint).
async function buildTicketLinkMatvey(bookingId, booking) {
  const version = Number(booking?.ticketLinkVersion || 1);
  const token = makeMatveyToken(bookingId, version);
  return { url: `${TICKET_PUBLIC_ORIGIN}/matvey-ticket.html?id=${encodeURIComponent(bookingId)}&tk=${encodeURIComponent(token)}`, token };
}

const TICKET_LINK_SECRET = process.env.TICKET_LINK_SECRET || '';
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function signToken(payloadB64) {
  if (!TICKET_LINK_SECRET) throw new Error('TICKET_LINK_SECRET not set');
  return crypto.createHmac('sha256', TICKET_LINK_SECRET).update(payloadB64).digest('base64url');
}
function makeMatveyToken(bookingId, version, ttlHours = 24 * 45) {
  const exp = Date.now() + ttlHours * 3600000;
  const payloadB64 = b64url(JSON.stringify({ bid: String(bookingId), v: Number(version) || 1, exp, show: 'matvey' }));
  return `${payloadB64}.${signToken(payloadB64)}`;
}
function verifyMatveyToken(token, bookingId) {
  if (!token || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false };
  const [payloadB64, sig] = parts;
  const expected = signToken(payloadB64);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  try {
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!p || String(p.bid) !== String(bookingId) || Date.now() > Number(p.exp)) return { ok: false };
    return { ok: true, payload: p };
  } catch { return { ok: false }; }
}

export default async (req, res) => {
  setCors(req, res, { methods: 'POST, GET, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Автоотмена зависших неоплаченных броней (>10 мин) + освобождение мест
  await runMatveyAutoCleanup().catch(() => {});

  // ── GET: конфиг оплаты, статус брони, ссылка/данные билета ──
  if (req.method === 'GET') {
    const getAction = String(req.query?.action || '').trim();

    if (getAction === 'get_config') {
      const creds = getTBankCredentials();
      return res.status(200).json({ mode: 'tbank', tbank: { enabled: Boolean(TBANK_MATVEY_ENABLED && creds.terminalKey && creds.password), testMode: creds.testMode, provider: 'tbank' } });
    }

    if (getAction === 'get_promo') {
      const pCode = String(req.query?.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,24}$/.test(pCode)) return res.status(400).json({ error: 'Invalid promo code' });
      const promo = await fbGet(`matvey_promo/${pCode}`);
      const nowTs = Date.now();
      const activeNow = Boolean(promo && promo.active === true
        && (!promo.expiresAt || nowTs <= Number(promo.expiresAt))
        && (!promo.validFrom || nowTs >= Number(promo.validFrom))
        && (!promo.validUntil || nowTs <= Number(promo.validUntil))
        && (promo.usesLeft == null || promo.usesLeft === -1 || Number(promo.usesLeft) > 0));
      if (!promo) return res.status(404).json({ activeNow: false });
      return res.status(200).json({
        activeNow,
        type: activeNow ? String(promo.type || '') : '',
        value: activeNow ? Number(promo.value || 0) : 0
      });
    }

    if (getAction === 'ticket_link') {
      const id = String(req.query?.id || '').trim();
      const clientKey = String(req.query?.clientKey || '').trim();
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const booking = await fbGet(`matvey_bookings/${id}`);
      if (!booking) return res.status(404).json({ error: 'Ticket not found' });
      if (!booking.clientKey || clientKey.length < 10 || booking.clientKey !== clientKey) return res.status(403).json({ error: 'Forbidden' });
      const st = String(booking.status || '').toLowerCase();
      if (BLOCKED_STATUSES.has(st)) return res.status(410).json({ error: 'Ticket revoked' });
      if (st !== 'confirmed') return res.status(409).json({ error: 'Ticket not confirmed yet' });
      const { url } = await buildTicketLinkMatvey(id, booking);
      return res.status(200).json({ ok: true, id, url });
    }

    if (getAction === 'ticket_data') {
      const id = String(req.query?.id || '').trim();
      const tk = String(req.query?.tk || '').trim();
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const booking = await fbGet(`matvey_bookings/${id}`);
      if (!booking) return res.status(404).json({ error: 'Ticket not found' });
      const st = String(booking.status || '').toLowerCase();
      if (BLOCKED_STATUSES.has(st)) return res.status(410).json({ error: 'Ticket revoked' });
      if (st !== 'confirmed') return res.status(409).json({ error: 'Ticket not confirmed yet' });
      const check = verifyMatveyToken(tk, id);
      if (!check.ok) return res.status(403).json({ error: 'Invalid or expired ticket link' });
      const cfg = await fbGet('matvey_config/show');
      return res.status(200).json({
        ok: true, bookingId: id,
        booking: {
          name: booking.name || '',
          seats: Array.isArray(booking.seats) ? booking.seats.map(seatLabel) : [],
          total: Number(booking.discountedTotal || booking.total || 0),
          ticketNumber: booking.ticketNumber || null,
          status: booking.status || ''
        },
        config: cfg || {}
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  const body = parseIncomingBody(req.body);
  const action = String(body?.action || req.query?.action || '').trim();

  // ── refund: возврат денег через T-Bank Cancel + освобождение мест (только админ) ──
  if (action === 'refund') {
    if (!(await isAdminAuthorized(req, body))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { bookingId } = body;
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
    const booking = await fbGet(`matvey_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const status = String(booking.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'returned') {
      return res.status(409).json({ error: 'Booking already closed' });
    }

    const reason = String(body?.reason || '').trim();
    if (status !== 'refunded') {
      let refundInfo = { attempted: false };
      const paymentId = String(booking?.tbank?.paymentId || '');
      if (paymentId) {
        const creds = getTBankCredentials();
        if (creds.terminalKey && creds.password) {
          const stateRes = await tbankApi('GetState', { PaymentId: paymentId }, creds);
          const bankState = String(stateRes.data?.Status || '').toUpperCase();

          const cancelRes = await tbankApi('Cancel', { PaymentId: paymentId }, creds);
          refundInfo = {
            attempted: true,
            ok: Boolean(cancelRes.httpOk && cancelRes.data?.Success),
            message: cancelRes.data?.Message || null,
            details: cancelRes.data?.Details || null,
            errorCode: cancelRes.data?.ErrorCode || null,
            tbankStatus: cancelRes.data?.Status || null,
            stateBefore: bankState || null
          };
          if (!refundInfo.ok) {
            const alreadyBack = ['CANCELED', 'CANCELLED', 'REFUNDED', 'REVERSED', 'PARTIAL_REFUNDED'].includes(bankState);
            if (!alreadyBack) {
              return res.status(502).json({ error: 'T-Bank refund failed', detail: refundInfo });
            }
            refundInfo.ok = true;
            refundInfo.idempotentBankState = bankState;
          }
        }
      }
      await fbPatch(`matvey_bookings/${bookingId}`, {
        status: 'refunded',
        refundedAt: Date.now(),
        refundReason: reason || null,
        ticketLinkVersion: Number(booking.ticketLinkVersion || 1) + 1,
        tbankRefund: refundInfo
      });
      const seats = Array.isArray(booking.seats) ? booking.seats : [];
      await Promise.all(seats.map(s => {
        const key = s && s.key ? s.key : null;
        return key ? fbPut(`matvey_seats/${key}`, { status: 'available' }).catch(() => {}) : Promise.resolve();
      })).catch(() => {});
    }

    return res.status(200).json({ ok: true });
  }

  // ── tbank_init: создать ссылку на оплату ──
  if (action === 'tbank_init') {
    if (!TBANK_MATVEY_ENABLED) return res.status(409).json({ error: 'T-Bank is not enabled' });
    if (await isMatveySalesPaused()) return res.status(409).json({ error: 'Продажи на «Спасти Матвея» временно остановлены' });
    const { bookingId } = body;
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
    const booking = await fbGet(`matvey_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.status || '').toLowerCase() === 'confirmed') return res.status(200).json({ ok: true, alreadyConfirmed: true });

    const amountRub = Number(booking.discountedTotal || 0);
    const amountKopek = Math.round(amountRub * 100);
    if (!Number.isFinite(amountKopek) || amountKopek <= 0) return res.status(409).json({ error: 'Invalid booking amount' });
    const creds = getTBankCredentials();
    if (!creds.terminalKey || !creds.password) return res.status(409).json({ error: 'T-Bank credentials are missing' });

    const initResult = await tbankApi('Init', {
      Amount: amountKopek,
      OrderId: bookingId,
      Description: 'Билеты на детский квест «Спасти Матвея»',
      NotificationURL: `${TICKET_PUBLIC_ORIGIN}/api/matvey?action=tbank_notify`,
      SuccessURL: `${TICKET_PUBLIC_ORIGIN}/concerts/matvey/index.html?pay=success`,
      FailURL: `${TICKET_PUBLIC_ORIGIN}/concerts/matvey/index.html?pay=fail`
    }, creds);

    if (!initResult.httpOk || !initResult.data?.Success) {
      console.error('[matvey tbank_init] failed:', JSON.stringify(initResult));
      return res.status(502).json({ error: initResult.data?.Message || initResult.error || 'T-Bank Init failed' });
    }
    await fbPatch(`matvey_bookings/${bookingId}`, { tbank: { paymentId: String(initResult.data.PaymentId || ''), status: 'Init', amount: amountRub } });
    return res.status(200).json({ ok: true, paymentUrl: initResult.data.PaymentURL });
  }

  // ── tbank_notify: вебхук — единственное место, где бронь становится confirmed ──
  if (action === 'tbank_notify') {
    const sendText = (code, text) => { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.status(code).send(String(text || '')); };
    const creds = getTBankCredentials();
    const payload = body && typeof body === 'object' ? body : {};
    const terminalKey = String(payload.TerminalKey || '').trim();
    const orderId = String(payload.OrderId || '').trim();
    const statusRaw = String(payload.Status || '').toUpperCase();
    if (!orderId) return sendText(400, 'BAD_ORDER');
    if (terminalKey && terminalKey !== creds.terminalKey) return sendText(403, 'BAD_TERMINAL');
    if (!verifyTBankToken(payload, creds.password)) return sendText(403, 'BAD_TOKEN');

    const booking = await fbGet(`matvey_bookings/${orderId}`);
    if (!booking) return sendText(200, 'OK');
    if (statusRaw === 'CONFIRMED' || statusRaw === 'AUTHORIZED') {
      const r = await confirmMatveyBooking(orderId, { paidAt: Date.now(), transactionId: payload.PaymentId });
      if (!r.ok) return sendText(500, 'FAIL_CONFIRM');
    }
    return sendText(200, 'OK');
  }

  // ── get_booking: опрос статуса (с фолбэком GetState) ──
  if (action === 'get_booking') {
    const { bookingId } = body;
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
    const booking = await fbGet(`matvey_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.status || '').toLowerCase() !== 'confirmed' && booking.tbank?.paymentId) {
      const creds = getTBankCredentials();
      const state = await tbankApi('GetState', { PaymentId: booking.tbank.paymentId }, creds);
      if (state.httpOk && state.data?.Success) {
        const s = String(state.data.Status).toUpperCase();
        if (s === 'CONFIRMED' || s === 'AUTHORIZED') await confirmMatveyBooking(bookingId, { paidAt: Date.now() });
      }
    }
    const updated = await fbGet(`matvey_bookings/${bookingId}`);
    return res.status(200).json({ ok: true, status: updated.status });
  }

  // ── Создание брони (основное действие без action) ──
  const { bookingId, name, phone, email, seats, tempBookingId, eventDate, promoCode } = body || {};

  if (await isMatveySalesPaused()) return res.status(409).json({ error: 'Продажи на «Спасти Матвея» временно остановлены' });
  if (!bookingId || !BOOKING_ID_RE.test(String(bookingId))) return res.status(400).json({ error: 'Invalid bookingId' });
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > NAME_MAX) return res.status(400).json({ error: 'Invalid name' });
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < PHONE_MIN_DIGITS) return res.status(400).json({ error: 'Invalid phone' });
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Invalid email' });
  if (!Array.isArray(seats) || seats.length === 0 || seats.length > MAX_SEATS) return res.status(400).json({ error: 'Invalid seats' });
  for (const s of seats) {
    if (!s || !SEAT_KEY_RE.test(String(s.key || ''))) return res.status(400).json({ error: `Invalid seat key: ${s && s.key}` });
    if (!ZONE_PRICES_FALLBACK.hasOwnProperty(String(s.zone))) return res.status(400).json({ error: `Invalid zone: ${s && s.zone}` });
  }

  const existing = await fbGet(`matvey_bookings/${bookingId}`);
  if (existing) return res.status(409).json({ error: 'Booking already exists' });

  // Серверная проверка доступности мест + атомарное резервирование (ETag)
  const now = Date.now();
  const taken = [];
  const snapshots = [];
  for (const s of seats) {
    const { data: seatData, etag } = await fbGetWithETag(`matvey_seats/${s.key}`);
    snapshots.push({ seat: s, etag, seatData });
    if (!seatData) continue;
    const st = String(seatData.status || '');
    const bid = String(seatData.bookingId || '');
    if (st === 'taken') taken.push(s.key);
    else if ((st === 'pending' || st === 'reserved') && bid !== tempBookingId) {
      const at = Number(seatData.reservedAt || seatData.at || 0);
      if (now - at < RESERVE_MS) taken.push(s.key);
    }
  }
  if (taken.length) return res.status(409).json({ error: 'Seats already taken', seats: taken });

  // Расчёт цены на сервере (клиенту не доверяем)
  const prices = await getZonePrices();
  const total = seats.reduce((sum, s) => sum + (prices[s.zone] || 0), 0);
  let discountedTotal = total;
  let promoApplied = null;
  if (promoCode) {
    const pCode = String(promoCode).trim().toUpperCase();
    const promo = /^[A-Z0-9_-]{2,24}$/.test(pCode) ? await fbGet(`matvey_promo/${pCode}`) : null;
    const nowTs = Date.now();
    const valid = Boolean(promo && promo.active === true
      && (!promo.expiresAt || nowTs <= Number(promo.expiresAt))
      && (!promo.validFrom || nowTs >= Number(promo.validFrom))
      && (!promo.validUntil || nowTs <= Number(promo.validUntil))
      && (promo.usesLeft == null || promo.usesLeft === -1 || Number(promo.usesLeft) > 0));
    if (valid) {
      const value = Number(promo.value || 0);
      if (promo.type === 'free') discountedTotal = 0;
      else if (promo.type === 'percent') discountedTotal = Math.round(total * (1 - value / 100));
      else if (promo.type === 'fixed') discountedTotal = Math.max(0, total - value);
      promoApplied = pCode;
    }
  }

  try {
    const clientKey = crypto.randomBytes(24).toString('hex');
    const booking = {
      name: cleanName, phone: digits, email: cleanEmail,
      eventDate: String(eventDate || '').trim().slice(0, 100),
      seats, total, discountedTotal, promoCode: promoApplied,
      status: 'pending_payment', createdAt: now, clientKey, ticketLinkVersion: 1
    };
    await fbPut(`matvey_bookings/${bookingId}`, booking);

    const reserved = [];
    let conflictKey = null;
    for (const snap of snapshots) {
      const path = `matvey_seats/${snap.seat.key}`;
      const newData = { ...(snap.seatData || {}), bookingId, status: 'reserved', reservedAt: now };
      if (snap.etag) {
        const ok = await fbConditionalPut(path, newData, snap.etag);
        if (!ok) { conflictKey = snap.seat.key; break; }
      } else {
        await fbPut(path, newData);
      }
      reserved.push(snap.seat.key);
    }
    if (conflictKey) {
      await Promise.all(reserved.map(k => fbPatch(`matvey_seats/${k}`, { bookingId: tempBookingId || null, status: tempBookingId ? 'reserved' : 'available' }).catch(() => {})));
      await fetch(`${FB_URL}/matvey_bookings/${bookingId}.json${FIREBASE_SECRET}`, { method: 'DELETE' }).catch(() => {});
      return res.status(409).json({ error: 'Seats already taken', seats: [conflictKey] });
    }

    return res.status(200).json({ ok: true, bookingId, clientKey, total, discountedTotal });
  } catch (err) {
    await Promise.all(seats.map(s => fbPatch(`matvey_seats/${s.key}`, { bookingId: tempBookingId || null }).catch(() => {}))).catch(() => {});
    await fetch(`${FB_URL}/matvey_bookings/${bookingId}.json${FIREBASE_SECRET}`, { method: 'DELETE' }).catch(() => {});
    return res.status(500).json({ error: 'Booking failed, please try again' });
  }
};
