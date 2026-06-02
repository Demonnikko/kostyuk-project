const crypto = require('crypto');
const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
const VK_TOKEN = process.env.VK_TOKEN || '';
const ADMIN_ID = parseInt(process.env.ADMIN_VK_ID) || 196783025;
const { isAdminAuthorized } = require('./_adminAuth');
const { validateTicketAccess } = require('./_ticketAccess');
const MINI_APP_BASE = process.env.VK_TICKETS_MINI_APP_URL || 'https://vk.com/app54466228_-209268664';
const TICKET_PUBLIC_ORIGIN = process.env.TICKET_PUBLIC_ORIGIN || 'https://vk-tickets.vercel.app';
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const TELEGRAM_ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.ADMIN_TELEGRAM_CHAT_ID || '').trim();
const TELEGRAM_SECRET_WEBAPP_URL = (process.env.TELEGRAM_SECRET_WEBAPP_URL || `${TICKET_PUBLIC_ORIGIN}/index.html`).trim();
const ADMIN_PANEL_URL = (process.env.SECRET_ADMIN_PANEL_URL || 'https://vk-tickets.vercel.app/admin.html').trim();
const { getTrustedTelegramUserId } = require('./_tg');
const { runSecretAutoCleanup } = require('./_autoCleanup');
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';
const RESERVE_MS = Number(process.env.TEMP_RESERVE_MS || 10 * 60 * 1000);
const VKPAY_SECRET_ENABLED = String(process.env.VKPAY_SECRET_ENABLED || process.env.VKPAY_ENABLED || '').trim().toLowerCase() === 'true';
const VKPAY_APP_ID = String(process.env.VKPAY_APP_ID || process.env.VK_APP_ID || '').trim();
const VKPAY_APP_SECURE_KEY = String(process.env.VKPAY_APP_SECURE_KEY || process.env.VK_APP_SECURE_KEY || '').trim();
const VKPAY_MERCHANT_ID = String(process.env.VKPAY_MERCHANT_ID || '').trim();
const VKPAY_MERCHANT_PRIVATE_KEY = String(process.env.VKPAY_MERCHANT_PRIVATE_KEY || '').trim();
const VKPAY_NOTIFY_PUBLIC_KEY = String(process.env.VKPAY_NOTIFY_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();

const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const BLOCKED_STATUSES = new Set(['cancelled', 'refunded', 'returned', 'deleted']);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha1Hex(text) {
  return crypto.createHash('sha1').update(String(text || ''), 'utf8').digest('hex');
}

function md5Hex(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

function parseIncomingBody(rawBody) {
  if (rawBody == null) return {};
  if (Buffer.isBuffer(rawBody)) return parseIncomingBody(rawBody.toString('utf8'));
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return {};
    try {
      const parsedJson = JSON.parse(trimmed);
      if (parsedJson && typeof parsedJson === 'object') return parsedJson;
    } catch { }
    try {
      const params = new URLSearchParams(trimmed);
      const parsed = {};
      for (const [k, v] of params.entries()) parsed[k] = v;
      if (Object.keys(parsed).length) return parsed;
    } catch { }
    return {};
  }
  if (typeof rawBody === 'object') return rawBody;
  return {};
}

function isSecretVkPayConfigured() {
  return VKPAY_SECRET_ENABLED
    && VKPAY_APP_ID
    && VKPAY_APP_SECURE_KEY
    && VKPAY_MERCHANT_ID
    && VKPAY_MERCHANT_PRIVATE_KEY;
}

function isSecretVkPayWebhookConfigured() {
  return isSecretVkPayConfigured() && VKPAY_NOTIFY_PUBLIC_KEY;
}

function makeVkPayDataPayload({ amount, currency = 'RUB', orderId, ts }) {
  const merchantDataObj = {
    amount: Number(amount),
    currency: String(currency || 'RUB'),
    order_id: String(orderId || ''),
    ts: String(ts || '')
  };
  const merchantData = Buffer.from(stableStringify(merchantDataObj), 'utf8').toString('base64');
  const merchantSign = sha1Hex(`${merchantData}${VKPAY_MERCHANT_PRIVATE_KEY}`);
  return {
    currency: merchantDataObj.currency,
    merchant_data: merchantData,
    merchant_sign: merchantSign,
    order_id: merchantDataObj.order_id,
    ts: merchantDataObj.ts
  };
}

function makeVkPayAppSign(params) {
  const keys = Object.keys(params).sort();
  const plain = keys.map((k) => {
    const v = params[k];
    if (v && typeof v === 'object') return `${k}=${stableStringify(v)}`;
    return `${k}=${String(v)}`;
  }).join('');
  return md5Hex(`${plain}${VKPAY_APP_SECURE_KEY}`);
}

function decodeVkPayNotificationData(raw) {
  const source = String(raw || '').trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch { }
  try {
    const decoded = Buffer.from(source, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function verifyVkPayNotificationSignature(dataRaw, signatureB64) {
  if (!VKPAY_NOTIFY_PUBLIC_KEY) return false;
  const sig = Buffer.from(String(signatureB64 || ''), 'base64');
  const payload = Buffer.from(String(dataRaw || ''), 'utf8');
  const algos = ['RSA-SHA256', 'RSA-SHA1'];
  for (const algo of algos) {
    try {
      const verifier = crypto.createVerify(algo);
      verifier.update(payload);
      verifier.end();
      if (verifier.verify(VKPAY_NOTIFY_PUBLIC_KEY, sig)) return true;
    } catch { }
  }
  return false;
}

function makeVkPayNotifyReply({ transactionId = '', notifyType = 'payment_delivered', ok = true, errorCode = 'INPUT', errorDescription = '' }) {
  const body = {
    transaction_id: String(transactionId || ''),
    notify_type: ok ? String(notifyType || 'payment_delivered') : 'TRANSACTION_STATUS'
  };
  const header = ok
    ? { status: 'OK' }
    : { status: 'ERROR', error: { code: String(errorCode || 'INPUT'), description: String(errorDescription || 'Error') } };
  const payload = { header, body };
  const data = Buffer.from(stableStringify(payload), 'utf8').toString('base64');
  const signature = sha1Hex(`${data}${VKPAY_MERCHANT_PRIVATE_KEY}`);
  return { data, signature };
}

function randomFromAlphabet(length, alphabet) {
  let out = '';
  const max = alphabet.length;
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(0, max)];
  return out;
}

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    return await r.json();
  } catch (e) { return null; }
}

async function fbPatch(path, data) {
  try {
    await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return true;
  } catch {
    return false;
  }
}

function getNotifyMeta(booking) {
  if (booking && typeof booking.notifyMeta === 'object' && booking.notifyMeta) {
    return booking.notifyMeta;
  }
  return {};
}

function hasNotifyFlag(booking, key) {
  const meta = getNotifyMeta(booking);
  return Number(meta[key] || 0) > 0;
}

async function markNotifyFlag(bookingId, booking, key) {
  const nextMeta = { ...getNotifyMeta(booking), [key]: Date.now() };
  booking.notifyMeta = nextMeta;
  return fbPatch(`ticket_bookings/${bookingId}`, { notifyMeta: nextMeta });
}

// Save notification to Firebase as fallback (always visible in admin panel)
async function fbSaveNotification(text, event, bookingId) {
  try {
    const key = `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    await fetch(`${FB_URL}/admin_notifications/${key}.json${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, event, bookingId, ts: Date.now(), read: false })
    });
  } catch { }
}

async function vkSend(userId, text) {
  if (!VK_TOKEN) return { ok: false, vkError: { error_msg: 'VK_TOKEN is not configured' } };
  const params = new URLSearchParams({
    peer_id: userId,
    message: text,
    random_id: crypto.randomInt(1, 2_000_000_000),
    access_token: VK_TOKEN,
    v: '5.199'
  });
  const r = await fetch('https://api.vk.com/method/messages.send', {
    method: 'POST',
    body: params
  });
  const data = await r.json();
  if (data.error) {
    console.error('[notify] vkSend error:', JSON.stringify(data.error));
    return { ok: false, vkError: data.error };
  }
  return { ok: true };
}

async function tgSend(chatId, text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false, error: { description: 'TELEGRAM_BOT_TOKEN/CHAT_ID is not configured' } };
  try {
    const payload = {
      chat_id: String(chatId),
      text: String(text),
      disable_web_page_preview: true
    };
    if (opts && typeof opts === 'object') {
      if (opts.reply_markup) payload.reply_markup = opts.reply_markup;
      if (opts.parse_mode) payload.parse_mode = String(opts.parse_mode);
    }
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!data.ok) console.error('[notify] tgSend error:', JSON.stringify(data));
    return data;
  } catch (e) {
    console.error('[notify] tgSend exception:', e.message);
    return { ok: false, error: { description: e.message } };
  }
}

async function isSecretSalesPaused() {
  const showCfg = await fbGet('ticket_config/show');
  return Boolean(showCfg && showCfg.salesPaused === true);
}

async function notifyAdmin(text) {
  const jobs = [];
  if (VK_TOKEN && Number.isFinite(ADMIN_ID) && ADMIN_ID > 0) {
    jobs.push(vkSend(ADMIN_ID, text).catch(() => ({ ok: false })));
  }
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
    jobs.push(tgSend(TELEGRAM_ADMIN_CHAT_ID, text).catch(() => ({ ok: false })));
  }
  if (!jobs.length) return [];
  return Promise.all(jobs);
}

function buildSecretMiniAppTicketLink(bookingId = '') {
  const params = new URLSearchParams({ tab: 'tickets' });
  if (bookingId) params.set('bookingId', String(bookingId));
  const hash = bookingId ? `#tickets/${encodeURIComponent(String(bookingId))}` : '#tickets';
  return `${MINI_APP_BASE}?${params.toString()}${hash}`;
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
  const primary = await tgSend(
    chatId,
    'Поздравляю с приобретением билета.\nСекрет ближе, чем тебе кажется 👇',
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '🎟 Мой билет', web_app: { url: tgLink } }
        ]]
      }
    }
  ).catch(() => ({ ok: false }));
  if (primary && primary.ok) return primary;
  return tgSend(chatId, `Поздравляю с приобретением билета.\nСекрет ближе, чем тебе кажется 👇\nВот твой билет: ${tgLink}`);
}

function hasOwnerAccessForSecretBooking(booking, body = {}) {
  const clientKey = String(body.clientKey || '').trim();
  if (booking.clientKey && clientKey && clientKey.length >= 10 && clientKey === booking.clientKey) return true;

  const trustedTgUserId = Number(body?._trustedTgUserId || 0);
  if (trustedTgUserId > 0 && booking.tgUserId && Number(booking.tgUserId) === trustedTgUserId) return true;

  if (ALLOW_VK_USERID_FALLBACK) {
    const vkUserId = Number(body.vkUserId || 0);
    if (vkUserId > 0 && booking.vkUserId && Number(booking.vkUserId) === vkUserId) return true;
  }

  return false;
}

async function findSecretBookingByVkPayOrderId(orderId) {
  const all = await fbGet('ticket_bookings');
  if (!all || typeof all !== 'object') return null;
  for (const [id, booking] of Object.entries(all)) {
    const bOrder = String(booking?.vkPay?.orderId || booking?.vkPayOrderId || '');
    if (bOrder && bOrder === String(orderId)) {
      return { bookingId: String(id), booking };
    }
  }
  return null;
}

async function confirmSecretBookingAndNotify(bookingId, booking, meta = {}) {
  const now = Date.now();
  const curStatus = String(booking.status || '').toLowerCase();
  if (BLOCKED_STATUSES.has(curStatus) || curStatus === 'refund_requested') {
    return { ok: false, error: `Cannot confirm: status is '${curStatus}'` };
  }
  if (curStatus !== 'pending_payment' && curStatus !== 'pending_confirmation' && curStatus !== 'new' && curStatus !== 'confirmed') {
    return { ok: false, error: `Cannot confirm: status is '${curStatus}'` };
  }

  if (curStatus !== 'confirmed') {
    const patch = {
      status: 'confirmed',
      confirmedAt: now
    };
    if (meta.paidAt) patch.paidAt = Number(meta.paidAt) || now;
    if (meta.transactionId || meta.orderId || meta.provider) {
      patch.vkPay = {
        ...(booking.vkPay && typeof booking.vkPay === 'object' ? booking.vkPay : {}),
        status: 'paid',
        paidAt: Number(meta.paidAt) || now,
        transactionId: String(meta.transactionId || booking?.vkPay?.transactionId || ''),
        orderId: String(meta.orderId || booking?.vkPay?.orderId || ''),
        provider: String(meta.provider || 'vkpay')
      };
    }
    await fbPatch(`ticket_bookings/${bookingId}`, patch);
    booking.status = 'confirmed';
    booking.confirmedAt = now;
    if (patch.paidAt) booking.paidAt = patch.paidAt;
    if (patch.vkPay) booking.vkPay = patch.vkPay;
  }

  await Promise.all((booking.seats || []).map((s) =>
    fetch(`${FB_URL}/ticket_seats/${s.tableId}_${s.seatIdx}.json${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'taken', bookingId })
    }).catch(() => { })
  ));

  let delivered = false;
  if (!hasNotifyFlag(booking, 'confirmedUserNotifiedAt')) {
    if (booking.vkUserId) {
      const ticketLink = buildSecretMiniAppTicketLink(bookingId);
      const msg = [
        'Поздравляю с приобретением билета.',
        'Секрет ближе, чем тебе кажется 👇',
        `Вот твой билет: ${ticketLink}`
      ].join('\n');
      const vkResult = await vkSend(booking.vkUserId, msg).catch(() => ({ ok: false }));
      delivered = delivered || !!vkResult?.ok;
    }
    if (booking.tgUserId) {
      const tgResult = await tgSendTicketReady(booking.tgUserId, bookingId).catch(() => ({ ok: false }));
      delivered = delivered || !!tgResult?.ok;
    }
    if (delivered || (!booking.vkUserId && !booking.tgUserId)) {
      await markNotifyFlag(bookingId, booking, 'confirmedUserNotifiedAt');
    }
  }

  return { ok: true };
}

const { setCors } = require('./_cors');

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST, OPTIONS' });
  await runSecretAutoCleanup().catch(() => {});

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = parseIncomingBody(req.body);
  if (body && typeof body === 'object' && typeof body.body === 'string' && !body.action && !body.data && !body.signature) {
    const nested = parseIncomingBody(body.body);
    if (nested && Object.keys(nested).length) body = nested;
  }
  if (body && typeof body === 'object') {
    body._trustedTgUserId = getTrustedTelegramUserId(body.tgInitData);
  }

  const action = String(body?.action || '').trim();
  const { bookingId, reason, rating, reviewText } = body || {};
  // Нормализуем event: body.action === 'refund_request' → event = 'refund_request'
  const event = body?.event || (action === 'refund_request' ? 'refund_request' : undefined);

  const isVkPayNotify = body
    && typeof body === 'object'
    && !event
    && !action
    && body.signature
    && body.data;

  if (isVkPayNotify) {
    if (!isSecretVkPayWebhookConfigured()) {
      return res.status(200).json(
        makeVkPayNotifyReply({
          ok: false,
          errorCode: 'SYSTEM',
          errorDescription: 'VK Pay integration is not configured'
        })
      );
    }

    const rawData = String(body.data || '');
    const signature = String(body.signature || '');
    if (!verifyVkPayNotificationSignature(rawData, signature)) {
      return res.status(200).json(
        makeVkPayNotifyReply({
          ok: false,
          errorCode: 'SECURITY',
          errorDescription: 'Invalid signature'
        })
      );
    }

    const payload = decodeVkPayNotificationData(rawData);
    if (!payload || typeof payload !== 'object') {
      return res.status(200).json(
        makeVkPayNotifyReply({
          ok: false,
          errorCode: 'INPUT',
          errorDescription: 'Invalid notification data'
        })
      );
    }

    const notifyTypeRaw = String(payload.notify_type || '').toLowerCase();
    const statusRaw = String(payload.status || payload.transaction_status || '').toUpperCase();
    const merchantParams = payload.merchant_params && typeof payload.merchant_params === 'object'
      ? payload.merchant_params
      : {};
    const orderId = String(merchantParams.order_id || payload.order_id || '').trim();
    const bookingIdFromPayload = String(merchantParams.booking_id || payload.booking_id || '').trim();
    const transactionId = String(payload.transaction_id || payload.transactionId || '').trim();
    const amount = Number(payload.amount || 0);

    let found = null;
    if (orderId) found = await findSecretBookingByVkPayOrderId(orderId);
    if (!found && bookingIdFromPayload) {
      const byId = await fbGet(`ticket_bookings/${bookingIdFromPayload}`);
      if (byId) found = { bookingId: bookingIdFromPayload, booking: byId };
    }
    if (!found) {
      return res.status(200).json(
        makeVkPayNotifyReply({
          ok: false,
          errorCode: 'ORDER_NOT_FOUND',
          errorDescription: 'Booking not found for order'
        })
      );
    }

    const { bookingId: resolvedBookingId, booking } = found;
    const successByType = notifyTypeRaw === 'payment_delivered';
    const successByStatus = ['OK', 'PAID', 'SUCCESS'].includes(statusRaw);
    const declinedByType = notifyTypeRaw === 'payment_declined';
    const declinedByStatus = ['DECLINED', 'FAILED', 'ERROR', 'CANCELLED'].includes(statusRaw);
    const isPaid = successByType || successByStatus;
    const isDeclined = declinedByType || declinedByStatus;

    const expectedAmount = Number(booking.discountedTotal || booking.total || 0);
    if (Number.isFinite(expectedAmount) && expectedAmount > 0 && Number.isFinite(amount) && amount > 0) {
      if (Math.abs(expectedAmount - amount) > 0.01) {
        return res.status(200).json(
          makeVkPayNotifyReply({
            ok: false,
            errorCode: 'INPUT',
            errorDescription: 'Amount mismatch'
          })
        );
      }
    }

    if (isPaid) {
      const result = await confirmSecretBookingAndNotify(resolvedBookingId, booking, {
        provider: 'vkpay',
        orderId,
        transactionId,
        paidAt: Date.now()
      });
      if (!result.ok) {
        return res.status(200).json(
          makeVkPayNotifyReply({
            ok: false,
            errorCode: 'SYSTEM',
            errorDescription: result.error || 'Failed to confirm booking'
          })
        );
      }
      return res.status(200).json(
        makeVkPayNotifyReply({
          ok: true,
          transactionId,
          notifyType: 'payment_delivered'
        })
      );
    }

    if (isDeclined) {
      const nextVkPay = {
        ...(booking.vkPay && typeof booking.vkPay === 'object' ? booking.vkPay : {}),
        status: 'failed',
        failedAt: Date.now(),
        orderId: String(orderId || booking?.vkPay?.orderId || ''),
        transactionId: String(transactionId || ''),
        lastNotifyType: notifyTypeRaw || null,
        lastNotifyStatus: statusRaw || null
      };
      const currentStatus = String(booking.status || '').toLowerCase();
      await fbPatch(`ticket_bookings/${resolvedBookingId}`, {
        status: currentStatus === 'confirmed' ? 'confirmed' : 'pending_payment',
        vkPay: nextVkPay
      });
      return res.status(200).json(
        makeVkPayNotifyReply({
          ok: true,
          transactionId,
          notifyType: 'payment_declined'
        })
      );
    }

    return res.status(200).json(
      makeVkPayNotifyReply({
        ok: false,
        errorCode: 'INPUT',
        errorDescription: 'Unknown transaction status'
      })
    );
  }

  if (action === 'get_config') {
    return res.status(200).json({
      salesPaused: await isSecretSalesPaused(),
      vkPay: {
        enabled: Boolean(isSecretVkPayConfigured())
      }
    });
  }

  // ── Заявка / запрос с сайта-мини-апп (без bookingId) ──
  if (event === 'order_request') {
    const ord = body.order || {};
    const isBooking = ord.type === 'booking';
    const vkUserLink = ord.vkUserId && ord.vkUserId !== '—'
      ? `👤 VK: https://vk.com/id${ord.vkUserId}` : null;

    const lines = [
      isBooking
        ? '🎩 ХОТЯТ ЗАБРОНИРОВАТЬ! — сайт site76'
        : '💬 Хочет написать лично — сайт site76',
      '',
      vkUserLink,
      '',
      ord.event ? `🎉 Мероприятие: ${ord.event}` : null,
      ord.guests ? `👥 Гостей: ${ord.guests}` : null,
      ord.region ? `🗺 Регион: ${ord.region}` : null,
      ord.city ? `📍 Город: ${ord.city}` : null,
      ord.date ? `📅 Дата: ${ord.date}` : null,
      ord.service ? `🎭 Формат: ${ord.service}` : null,
      ord.duration ? `⏱ Длительность: ${ord.duration}` : null,
      isBooking && ord.total
        ? `\n💰 ИТОГО: ${ord.total.toLocaleString('ru-RU')} ₽ (предоплата ${(ord.prepay || 0).toLocaleString('ru-RU')} ₽)`
        : null,
      isBooking ? '\n✅ Ждёт подтверждения даты от вас.' : null,
    ].filter(l => l !== null).join('\n');

    await fbSaveNotification(lines, 'order_request', null);
    const notifyResult = await notifyAdmin(lines);
    console.log('[notify] order_request → notifyAdmin result:', JSON.stringify(notifyResult));
    return res.status(200).json({ ok: true });
  }

  // ── Удаление отзыва (admin only, не требует bookingId) ──
  if (event === 'delete_review') {
    if (!(await isAdminAuthorized(req, body))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const reviewId = String(body.reviewId || '').trim();
    const show = String(body.show || 'secret').trim();
    if (!reviewId) return res.status(400).json({ error: 'Missing reviewId' });

    const collection = show === 'huligan' ? 'huligan_reviews' : 'ticket_reviews';
    await fetch(`${FB_URL}/${collection}/${reviewId}.json${FIREBASE_SECRET}`, { method: 'DELETE' });

    // Сбрасываем флаг reviewed/reviewPromoIssued на бронировании
    if (bookingId && bookingId !== 'none') {
      const bookingCollection = show === 'huligan' ? 'huligan_bookings' : 'ticket_bookings';
      const patch = show === 'huligan' ? { reviewed: false } : { reviewPromoIssued: false };
      await fetch(`${FB_URL}/${bookingCollection}/${bookingId}.json${FIREBASE_SECRET}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
    }

    return res.status(200).json({ ok: true });
  }

  if (action === 'vkpay_prepare') {
    if (await isSecretSalesPaused()) {
      return res.status(409).json({ error: 'Продажи на шоу «Секрет» временно остановлены' });
    }
    if (!isSecretVkPayConfigured()) {
      return res.status(409).json({ error: 'VK Pay is not configured' });
    }
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isAdmin = await isAdminAuthorized(req, body);
    if (!isAdmin && !hasOwnerAccessForSecretBooking(booking, body)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const status = String(booking.status || '').toLowerCase();
    if (BLOCKED_STATUSES.has(status) || status === 'refund_requested') {
      return res.status(409).json({ error: `Cannot pay in status '${status}'` });
    }
    if (status === 'confirmed') {
      return res.status(200).json({ ok: true, alreadyConfirmed: true });
    }
    if (status !== 'pending_payment' && status !== 'pending_confirmation' && status !== 'new') {
      return res.status(409).json({ error: `Cannot pay in status '${status}'` });
    }

    const amount = Number(booking.discountedTotal || booking.total || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      const freeConfirm = await confirmSecretBookingAndNotify(bookingId, booking, {
        provider: 'vkpay',
        paidAt: Date.now()
      });
      if (!freeConfirm.ok) {
        return res.status(500).json({ error: freeConfirm.error || 'Failed to confirm booking' });
      }
      return res.status(200).json({ ok: true, alreadyConfirmed: true, freeTicket: true });
    }

    const ts = Math.floor(Date.now() / 1000);
    const orderId = `${bookingId}-${ts}`;
    const amountRounded = Math.round(amount * 100) / 100;
    const payData = makeVkPayDataPayload({
      amount: amountRounded,
      currency: 'RUB',
      orderId,
      ts
    });
    payData.booking_id = String(bookingId);

    const params = {
      amount: amountRounded,
      data: payData,
      description: 'Билет на Шоу «Секрет» 12+',
      merchant_id: Number(VKPAY_MERCHANT_ID),
      version: 2
    };
    params.sign = makeVkPayAppSign(params);

    await fbPatch(`ticket_bookings/${bookingId}`, {
      status: status === 'new' ? 'pending_payment' : status,
      vkPay: {
        ...(booking.vkPay && typeof booking.vkPay === 'object' ? booking.vkPay : {}),
        provider: 'vkpay',
        status: 'prepared',
        preparedAt: Date.now(),
        orderId,
        amount: amountRounded
      }
    });

    return res.status(200).json({
      ok: true,
      orderId,
      payload: {
        app_id: Number(VKPAY_APP_ID),
        action: 'pay-to-service',
        params
      }
    });
  }

  if (action === 'vkpay_client_result') {
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const isAdmin = await isAdminAuthorized(req, body);
    if (!isAdmin && !hasOwnerAccessForSecretBooking(booking, body)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const paymentResult = body?.paymentResult && typeof body.paymentResult === 'object' ? body.paymentResult : {};
    const nextVkPay = {
      ...(booking.vkPay && typeof booking.vkPay === 'object' ? booking.vkPay : {}),
      clientResultAt: Date.now(),
      clientResult: {
        status: Boolean(paymentResult.status),
        transaction_id: String(paymentResult.transaction_id || ''),
        amount: String(paymentResult.amount || ''),
        extra: String(paymentResult.extra || '')
      }
    };
    await fbPatch(`ticket_bookings/${bookingId}`, { vkPay: nextVkPay });
    return res.status(200).json({ ok: true });
  }

  if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

  try {
    // События, доступные только администратору
    const ADMIN_EVENTS = new Set(['confirmed', 'admin_booking_update']);
    if (ADMIN_EVENTS.has(event)) {
      const ok = await isAdminAuthorized(req, body);
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // События пользователя — только владелец брони:
    // clientKey ИЛИ проверенный tgInitData ИЛИ валидный ticketToken.
    // vkUserId-фолбэк отключён по умолчанию (включается env ALLOW_VK_USERID_FALLBACK=true).
    const USER_EVENTS = new Set(['cancelled', 'refund_requested', 'review', 'refund_request']);
    if (USER_EVENTS.has(event)) {
      let hasOwnerAccess = hasOwnerAccessForSecretBooking(booking, body);

      // Для deeplink-билетов разрешаем подтверждать владельца подписью tk-токена.
      if (!hasOwnerAccess) {
        const ticketToken = String(body.ticketToken || body.tk || '').trim();
        if (ticketToken) {
          const tokenCheck = validateTicketAccess(bookingId, ticketToken, booking);
          if (tokenCheck.ok) hasOwnerAccess = true;
        }
      }

      if (!hasOwnerAccess) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const zoneName = (z) => z === 'vip' ? 'VIP' : z === 'standart' ? 'Стандарт' : 'Эконом';
    const seatsText = (booking.seats || [])
      .map(s => `  • Стол ${s.tableId}, место ${s.seatIdx + 1} (${zoneName(s.zone)})`)
      .join('\n');
    const vkLink = booking.vkUserId ? `👤 VK: https://vk.com/id${booking.vkUserId}` : null;
    const tgRef = booking.tgUserId
      ? `tg://user?id=${booking.tgUserId}`
      : (booking.tgUsername ? `https://t.me/${String(booking.tgUsername).replace(/^@/, '')}` : null);
    const tgLink = tgRef ? `💬 TG: ${tgRef}` : null;

    // ── Новая заявка на оплату ──
    if (event === 'paid') {
      if (await isSecretSalesPaused()) {
        return res.status(409).json({ error: 'Продажи на шоу «Секрет» временно остановлены' });
      }
      // Принимаем уведомление только если бронь в ожидании оплаты
      const st = String(booking.status || '').toLowerCase();
      if (st === 'pending_payment') {
        const createdAt = Number(booking.createdAt || 0);
        if (Number.isFinite(createdAt) && createdAt > 0 && (Date.now() - createdAt) > RESERVE_MS) {
          const currentVersion = Number(booking.ticketLinkVersion || 1);
          await fbPatch(`ticket_bookings/${bookingId}`, {
            status: 'cancelled',
            cancelledAt: Date.now(),
            autoCancelledAt: Date.now(),
            cancelReason: 'Автоотмена: истекло 10 минут на оплату',
            ticketLinkVersion: currentVersion + 1
          });
          await Promise.all((booking.seats || []).map(s =>
            fetch(`${FB_URL}/ticket_seats/${s.tableId}_${s.seatIdx}.json${FIREBASE_SECRET}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'available' })
            }).catch(() => {})
          ));
          return res.status(409).json({ error: 'Payment timeout exceeded' });
        }
      }
      if (st === 'pending_confirmation' && hasNotifyFlag(booking, 'paidAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      if (st !== 'pending_payment' && st !== 'new') {
        return res.status(409).json({ error: 'Booking is not awaiting payment' });
      }
      // Сервер сам переводит статус — клиент не пишет в Firebase напрямую
      const paidAt = Date.now();
      const patch = { status: 'pending_confirmation', paidAt };
      const incomingVkUserId = Number(body.vkUserId || 0);
      const incomingTgUserId = Number(body?._trustedTgUserId || 0);
      if (!booking.vkUserId && Number.isFinite(incomingVkUserId) && incomingVkUserId > 0) {
        patch.vkUserId = incomingVkUserId;
      }
      if (!booking.tgUserId && Number.isFinite(incomingTgUserId) && incomingTgUserId > 0) {
        patch.tgUserId = incomingTgUserId;
      }
      await fbPatch(`ticket_bookings/${bookingId}`, patch);
      if (patch.vkUserId) booking.vkUserId = patch.vkUserId;
      if (patch.tgUserId) booking.tgUserId = patch.tgUserId;
      booking.status = 'pending_confirmation';
      booking.paidAt = paidAt;
      const vkLinkPaid = booking.vkUserId ? `👤 VK: https://vk.com/id${booking.vkUserId}` : null;
      const tgRefPaid = booking.tgUserId
        ? `tg://user?id=${booking.tgUserId}`
        : (booking.tgUsername ? `https://t.me/${String(booking.tgUsername).replace(/^@/, '')}` : null);
      const tgLinkPaid = tgRefPaid ? `💬 TG: ${tgRefPaid}` : null;
      // Блокируем места чтобы их не забрал другой покупатель
      await Promise.all((booking.seats || []).map(s =>
        fetch(`${FB_URL}/ticket_seats/${s.tableId}_${s.seatIdx}.json${FIREBASE_SECRET}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'taken', bookingId })
        })
      ));
      const lines = [
        '💳 Новая заявка на оплату — Шоу «СЕКРЕТ»',
        '',
        `Имя: ${booking.name}`,
        `Телефон: ${booking.phone}`,
        vkLinkPaid,
        tgLinkPaid,
        '',
        'Места:',
        seatsText,
        '',
        `Сумма: ${booking.discountedTotal || booking.total} ₽`,
        booking.promoCode ? `Промокод: ${booking.promoCode}` : null,
        '',
        `🆔 Бронь: ${bookingId}`,
        '',
        `✅ Подтвердить: ${ADMIN_PANEL_URL}`
      ].filter(l => l !== null).join('\n');

      // Always save to Firebase (visible in admin panel even if VK fails)
      await fbSaveNotification(lines, 'paid', bookingId);

      const notifyResult = await notifyAdmin(lines);
      await markNotifyFlag(bookingId, booking, 'paidAdminNotifiedAt');
      console.log('[notify] paid → notifyAdmin result:', JSON.stringify(notifyResult));
      return res.status(200).json({ ok: true });
    }

    // ── Оплата подтверждена — сообщить пользователю ──
    if (event === 'confirmed') {
      if (hasNotifyFlag(booking, 'confirmedUserNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      let delivered = false;
      if (booking.vkUserId) {
        const ticketLink = buildSecretMiniAppTicketLink(bookingId);
        const msg = [
          'Поздравляю с приобретением билета.',
          `Секрет ближе, чем тебе кажется 👇`,
          `Вот твой билет: ${ticketLink}`
        ].join('\n');
        const vkResult = await vkSend(booking.vkUserId, msg);
        delivered = delivered || !!vkResult?.ok;
        console.log('[notify] confirmed → vkSend user result:', JSON.stringify(vkResult));
      }
      if (booking.tgUserId) {
        const tgResult = await tgSendTicketReady(booking.tgUserId, bookingId).catch(() => ({ ok: false }));
        delivered = delivered || !!tgResult?.ok;
      }
      if (delivered || (!booking.vkUserId && !booking.tgUserId)) {
        await markNotifyFlag(bookingId, booking, 'confirmedUserNotifiedAt');
      }
      return res.status(200).json({ ok: true });
    }

    // ── Пользователь отменил бронь ──
    if (event === 'cancelled') {
      // Только если бронь ещё не подтверждена (подтверждённые идут через refund_requested)
      const stCancelled = String(booking.status || '').toLowerCase();
      if (stCancelled === 'cancelled' && hasNotifyFlag(booking, 'cancelledAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      if (stCancelled === 'confirmed') {
        return res.status(409).json({ error: 'Confirmed booking must use refund flow' });
      }
      // Сервер обновляет статус и освобождает места
      const currentVersion = Number(booking.ticketLinkVersion || 1);
      if (stCancelled !== 'cancelled') {
        await fbPatch(`ticket_bookings/${bookingId}`, {
          status: 'cancelled',
          cancelReason: String(body.reason || ''),
          ticketLinkVersion: currentVersion + 1,
          ticketRevokedAt: Date.now()
        });
      }
      await Promise.all((booking.seats || []).map(s =>
        fetch(`${FB_URL}/ticket_seats/${s.tableId}_${s.seatIdx}.json${FIREBASE_SECRET}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'available' })
        })
      ));
      const lines = [
        '❌ Бронь отменена — Шоу «СЕКРЕТ»',
        '',
        `Имя: ${booking.name}`,
        `Телефон: ${booking.phone}`,
        vkLink,
        tgLink,
        '',
        'Места:',
        seatsText,
        '',
        `Сумма была: ${booking.discountedTotal || booking.total} ₽`,
        `🆔 Бронь: ${bookingId}`,
        reason ? `\n💬 Причина: ${reason}` : null,
      ].filter(l => l !== null).join('\n');

      await fbSaveNotification(lines, 'cancelled', bookingId);
      const notifyResult = await notifyAdmin(lines);
      await markNotifyFlag(bookingId, booking, 'cancelledAdminNotifiedAt');
      console.log('[notify] cancelled → notifyAdmin result:', JSON.stringify(notifyResult));
      return res.status(200).json({ ok: true });
    }

    // ── Запрос на возврат ──
    if (event === 'refund_requested') {
      const stRefundReq = String(booking.status || '').toLowerCase();
      if (stRefundReq === 'refund_requested' && hasNotifyFlag(booking, 'refundRequestedAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      // Сервер обновляет статус брони
      if (stRefundReq !== 'refund_requested') {
        await fbPatch(`ticket_bookings/${bookingId}`, {
          status: 'refund_requested',
          refundReason: String(body.reason || ''),
          refundRequestedAt: Date.now()
        });
      }
      const lines = [
        '↩ Запрос на возврат — Шоу «СЕКРЕТ»',
        '',
        `Имя: ${booking.name}`,
        `Телефон: ${booking.phone}`,
        vkLink,
        tgLink,
        '',
        'Места:',
        seatsText,
        '',
        `Сумма: ${booking.discountedTotal || booking.total} ₽`,
        `🆔 Бронь: ${bookingId}`,
        '',
        reason ? `💬 Причина: ${reason}` : '💬 Причина не указана',
        '',
        `🔧 Оформить: ${ADMIN_PANEL_URL}`
      ].filter(l => l !== null).join('\n');

      await fbSaveNotification(lines, 'refund_requested', bookingId);
      const notifyResult = await notifyAdmin(lines);
      await markNotifyFlag(bookingId, booking, 'refundRequestedAdminNotifiedAt');
      console.log('[notify] refund_requested → notifyAdmin result:', JSON.stringify(notifyResult));
      return res.status(200).json({ ok: true });
    }

    // ── Админ оформил возврат/отмену — уведомить зрителя ──
    if (event === 'admin_booking_update') {
      const status = String(body?.status || booking.status || '').toLowerCase();
      const key = `adminUpdateUserNotified_${status}`;
      if (hasNotifyFlag(booking, key)) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      const msg = status === 'refunded'
        ? [
          '↩ Возврат оформлен',
          '',
          'Ваш билет на Шоу «Секрет» аннулирован.',
          'Деньги будут возвращены по вашему запросу.',
          'Спасибо, что обратились к нам.',
          '',
          'Если удобно, напишите в ответ, почему вы решили вернуть билет.',
          '',
          `🆔 Бронь: ${bookingId}`
        ].join('\n')
        : [
          '❌ Бронь отменена',
          '',
          'Ваша бронь на Шоу «Секрет» отменена администратором.',
          '',
          `🆔 Бронь: ${bookingId}`
        ].join('\n');
      if (booking.vkUserId) {
        await vkSend(booking.vkUserId, msg);
      }
      if (booking.tgUserId) {
        await tgSend(booking.tgUserId, msg).catch(() => { });
      }
      await markNotifyFlag(bookingId, booking, key);
      return res.status(200).json({ ok: true });
    }

    // ── Новый отзыв ──
    if (event === 'review') {
      if (booking.status !== 'confirmed') {
        return res.status(409).json({ error: 'Can only review confirmed bookings' });
      }
      if (booking.reviewPromoIssued) {
        return res.status(409).json({ error: 'Already reviewed' });
      }

      if (!reviewText) {
        return res.status(400).json({ error: 'Review text required' });
      }

      // Сохраняем отзыв в Firebase
      const now = Date.now();
      const TWO_MONTHS_MS = 60 * 24 * 3600000; // ~60 дней
      const expiresAt = now + TWO_MONTHS_MS;
      const expiresDate = new Date(expiresAt).toLocaleDateString('ru-RU');

      const reviewId = `R-${bookingId}-${now}`;
      const reviewRating = Math.min(5, Math.max(1, Number(rating) || 5));

      // Промокод генерируется СЕРВЕРОМ (срок — 2 месяца)
      let serverPromoCode = `REV-${randomFromAlphabet(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')}`;

      await fetch(`${FB_URL}/ticket_reviews/${reviewId}.json${FIREBASE_SECRET}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId, rating: reviewRating, text: reviewText,
          promoCode: serverPromoCode, createdAt: now,
          name: booking.name || '', vkUserId: booking.vkUserId || null, tgUserId: booking.tgUserId || null
        })
      });

      try {
        await fetch(`${FB_URL}/ticket_promo/${serverPromoCode}.json${FIREBASE_SECRET}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'fixed', value: 200, usesLeft: 1,
            active: true, description: 'Бонус за отзыв — скидка 200 ₽',
            createdAt: now, expiresAt,
            vkUserId: booking.vkUserId || null,
            tgUserId: booking.tgUserId || null,
            bookingId
          })
        });
        await fbPatch(`ticket_bookings/${bookingId}`, { reviewPromoIssued: true, reviewPromoCode: serverPromoCode });
      } catch { serverPromoCode = null; }

      const stars = '⭐'.repeat(reviewRating);
      const adminLines = [
        `${stars} Новый отзыв — Шоу «СЕКРЕТ»`,
        '',
        `Имя: ${booking.name}`,
        vkLink,
        tgLink,
        `🆔 Бронь: ${bookingId}`,
        '',
        `«${reviewText}»`,
        serverPromoCode ? `🎁 Промокод: ${serverPromoCode} (до ${expiresDate})` : null,
      ].filter(l => l !== null).join('\n');

      await fbSaveNotification(adminLines, 'review', bookingId);
      await notifyAdmin(adminLines).catch(() => { });

      // Отправляем промокод покупателю в ВК
      if (serverPromoCode && booking.vkUserId) {
        const userMsg = [
          `Спасибо за отзыв о Шоу «Секрет»! ✨`,
          '',
          `Ваш персональный промокод на скидку 200 ₽:`,
          `🎁 ${serverPromoCode}`,
          '',
          `Действует до ${expiresDate}.`,
          'Используйте при следующей покупке билета!'
        ].join('\n');
        await vkSend(booking.vkUserId, userMsg).catch(() => { });
      }
      if (serverPromoCode && booking.tgUserId) {
        const userMsg = [
          `Спасибо за отзыв о Шоу «Секрет»! ✨`,
          '',
          `Ваш персональный промокод на скидку 200 ₽:`,
          `🎁 ${serverPromoCode}`,
          '',
          `Действует до ${expiresDate}.`,
          'Используйте при следующей покупке билета!'
        ].join('\n');
        await tgSend(booking.tgUserId, userMsg).catch(() => { });
      }

      return res.status(200).json({ ok: true, promoCode: serverPromoCode, expiresDate });
    }

    // ── Возврат билета ──
    if (event === 'refund_request' || body.action === 'refund_request') {
      if (hasNotifyFlag(booking, 'refundRequestLegacyAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      const lines = [
        '↩ ЗАПРОС НА ВОЗВРАТ — Шоу «СЕКРЕТ»',
        '',
        `Имя: ${booking.name}`,
        `Телефон: ${booking.phone || '—'}`,
        vkLink,
        tgLink,
        `🆔 Бронь: ${bookingId}`,
        '',
        '⚠️ Нужно вернуть деньги. Свяжитесь с клиентом!'
      ].filter(l => l !== null).join('\n');

      await fbSaveNotification(lines, 'refund', bookingId);
      const notifyResult = await notifyAdmin(lines);
      await markNotifyFlag(bookingId, booking, 'refundRequestLegacyAdminNotifiedAt');
      console.log('[notify] refund_request → notifyAdmin result:', JSON.stringify(notifyResult));
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[notify] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
