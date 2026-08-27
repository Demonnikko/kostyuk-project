/**
 * Prodamus — разовая оплата брони (НЕ подписка). Общий эндпоинт для шоу
 * «Секрет» и «ХУЛИgan». Матвей — не участвует (там нет онлайн-оплаты).
 *
 * action=init        — создать ссылку на оплату для конкретной попытки оплаты
 * action=notify       — вебхук Prodamus (единственное место, где бронь становится confirmed)
 * action=get_status    — опрос статуса брони с фронта (истина всегда из Firebase, не из Prodamus API)
 *
 * Схема места: free → reserved(10м, seats.js) → payment_pending(linkExpiredAt+15м grace) → taken.
 * Ветки → free: TTL/cancel/denied/expired. Ветка → paid_conflict: деньги пришли, но место уже
 * занято другим — НЕ отбираем место, НЕ подтверждаем бронь автоматически, ждём админа.
 *
 * ВАЖНО: этот файл НЕ включён в роутер api/[endpoint].js, пока не пройден
 * реальный тестовый платёж (см. HANDOFF.md/PRODAMUS-TEST-PLAN.md). До этого
 * PRODAMUS_ENABLED должен быть false/не задан на проде.
 */
import crypto from 'crypto';
import { fbGet, fbGetWithETag, fbConditionalPut, fbPatch } from '../../shared/firebase.js';
import { buildProdamusSignature, verifyProdamusSignature, parseProdamusFormBody } from '../../shared/prodamus-sign.js';
import { recordReceived, markProcessed } from '../../shared/payment-events.js';
import { setCors } from '../../shared/cors.js';
import { confirmSecretBooking } from './book.js';
import { confirmBookingAndNotify as confirmHuliganBooking } from './huligan.js';

const PRODAMUS_ENABLED = String(process.env.PRODAMUS_ENABLED || '').trim().toLowerCase() === 'true';
const PRODAMUS_SECRET_KEY = String(process.env.PRODAMUS_SECRET_KEY || '').trim();
const PRODAMUS_FORM_URL = String(process.env.PRODAMUS_FORM_URL || '').trim();
const PRODAMUS_SYS = String(process.env.PRODAMUS_SYS || '').trim();
const TICKET_PUBLIC_ORIGIN = process.env.TICKET_PUBLIC_ORIGIN || 'https://vk-tickets.vercel.app';

const LINK_TTL_MS = Number(process.env.PRODAMUS_LINK_TTL_MS || 20 * 60 * 1000); // 20 минут на оплату по ссылке
const GRACE_MS = Number(process.env.PRODAMUS_GRACE_MS || 15 * 60 * 1000); // +15 минут запаса на доставку вебхука

const SHOW_MAP = {
  secret: { bookingsNode: 'ticket_bookings', seatsNode: 'ticket_seats', label: 'Секрет' },
  huligan: { bookingsNode: 'huligan_bookings', seatsNode: 'huligan_seats', label: 'ХУЛИgan' }
};

function isConfigured() {
  return Boolean(PRODAMUS_ENABLED && PRODAMUS_SECRET_KEY && PRODAMUS_FORM_URL);
}

function parseIncomingBody(req) {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const trimmed = text.trim();
  if (!trimmed) return {};
  const contentType = String(req.headers?.['content-type'] || '');
  if (contentType.includes('application/json')) {
    try { return JSON.parse(trimmed); } catch { return {}; }
  }
  // Prodamus шлёт вебхук как x-www-form-urlencoded с PHP-нотацией.
  return parseProdamusFormBody(trimmed);
}

function getShowConfig(show) {
  return SHOW_MAP[String(show || '').toLowerCase()] || null;
}

async function getBooking(show, bookingId) {
  const cfg = getShowConfig(show);
  if (!cfg) return null;
  return fbGet(`${cfg.bookingsNode}/${bookingId}`);
}

/** Сумма брони — читаем то, что уже посчитал сервер при создании (не пересчитываем). */
function getBookingAmount(show, booking) {
  if (show === 'secret') return Number(booking?.discountedTotal || 0);
  if (show === 'huligan') return Number(booking?.finalPrice || 0);
  return 0;
}

function getBookingStatus(booking) {
  return String(booking?.status || '').toLowerCase();
}

const SECRET_BLOCKED = new Set(['confirmed', 'cancelled', 'refunded', 'returned', 'deleted']);
const HULIGAN_BLOCKED = new Set(['cancelled', 'refunded', 'returned', 'deleted']);

function isBlockedForPayment(show, status) {
  if (show === 'secret') return SECRET_BLOCKED.has(status) && status !== 'pending_payment';
  if (show === 'huligan') return HULIGAN_BLOCKED.has(status);
  return true;
}

function isAlreadyConfirmed(status) {
  return status === 'confirmed';
}

/**
 * Помечает места брони как payment_pending (вместо простого reserved) на время
 * жизни платёжной ссылки. Это отдельный, более длинный тайм-аут, чем обычный
 * HOLD (10 мин) — автоочистка НЕ должна трогать payment_pending раньше
 * paymentHoldUntil (см. shared/autoCleanup.js).
 */
async function markSeatsPaymentPending(show, booking, paymentHoldUntil) {
  const cfg = getShowConfig(show);
  const seats = Array.isArray(booking?.seats) ? booking.seats : [];
  await Promise.all(seats.map(async s => {
    const seatKey = s.key || `${s.tableId}_${s.seatIdx}`;
    try {
      const { data: cur, etag } = await fbGetWithETag(`${cfg.seatsNode}/${seatKey}`);
      if (!cur) return;
      await fbConditionalPut(`${cfg.seatsNode}/${seatKey}`, {
        ...cur,
        status: 'payment_pending',
        paymentHoldUntil
      }, etag);
    } catch { /* лучший эффорт — вебхук/автоочистка доразрулят при следующем проходе */ }
  }));
}

function genAttemptId() {
  return `att${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function buildOrderNum(bookingId, attemptId) {
  return `${bookingId}-${attemptId}`;
}

/** order_num = bookingId + '-' + attemptId. bookingId сам может содержать дефисы,
 * поэтому режем по последнему сегменту (attemptId всегда начинается с 'att'). */
function parseOrderNum(orderNum) {
  const str = String(orderNum || '');
  const idx = str.lastIndexOf('-att');
  if (idx < 0) return { bookingId: str, attemptId: '' };
  return { bookingId: str.slice(0, idx), attemptId: str.slice(idx + 1) };
}

function buildPaymentLink({ orderNum, amountRub, description, show }) {
  const url = new URL(PRODAMUS_FORM_URL);
  url.searchParams.set('do', 'link');
  url.searchParams.set('order_id', orderNum);
  url.searchParams.set('customer_extra', description);
  url.searchParams.set('products[0][name]', description);
  url.searchParams.set('products[0][price]', String(amountRub));
  url.searchParams.set('products[0][quantity]', '1');
  url.searchParams.set('payments_limit', '1'); // одна попытка оплаты на ссылку
  url.searchParams.set('link_expired', new Date(Date.now() + LINK_TTL_MS).toISOString().slice(0, 19).replace('T', ' '));
  url.searchParams.set('urlReturn', `${TICKET_PUBLIC_ORIGIN}/concerts/${show}/index.html?pay=fail`);
  url.searchParams.set('urlSuccess', `${TICKET_PUBLIC_ORIGIN}/concerts/${show}/index.html?pay=success`);
  url.searchParams.set('urlNotification', `${TICKET_PUBLIC_ORIGIN}/api/prodamus?action=notify`);
  if (PRODAMUS_SYS) url.searchParams.set('sys', PRODAMUS_SYS);
  url.searchParams.set('_param_bookingId', '');
  url.searchParams.set('_param_show', show);
  return url.toString();
}

async function confirmBookingByShow(show, bookingId, meta) {
  if (show === 'secret') return confirmSecretBooking(bookingId, meta);
  if (show === 'huligan') {
    const booking = await getBooking(show, bookingId);
    return confirmHuliganBooking(bookingId, booking, meta);
  }
  return { ok: false, error: 'Unknown show' };
}

/** Откатывает payment_pending обратно в free для мест брони (деклайн/истёк срок). */
async function releaseSeatsToFree(show, booking) {
  const cfg = getShowConfig(show);
  const seats = Array.isArray(booking?.seats) ? booking.seats : [];
  await Promise.all(seats.map(async s => {
    const seatKey = s.key || `${s.tableId}_${s.seatIdx}`;
    try {
      const { data: cur, etag } = await fbGetWithETag(`${cfg.seatsNode}/${seatKey}`);
      if (!cur || cur.status !== 'payment_pending') return;
      await fbConditionalPut(`${cfg.seatsNode}/${seatKey}`, { status: 'available' }, etag);
    } catch { /* best effort */ }
  }));
}

export default async (req, res) => {
  setCors(req, res, { methods: 'POST, GET, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query || {};
  const action = String(query.action || '').trim();
  const body = parseIncomingBody(req);

  // ── action=init: создать платёжную ссылку под конкретную попытку оплаты ──
  if (action === 'init') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isConfigured()) return res.status(409).json({ error: 'Prodamus is not enabled' });

    const show = String(body.show || '').toLowerCase();
    const bookingId = String(body.bookingId || '').trim();
    const cfg = getShowConfig(show);
    if (!cfg) return res.status(400).json({ error: 'Invalid show' });
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

    const booking = await getBooking(show, bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const status = getBookingStatus(booking);
    if (isAlreadyConfirmed(status)) return res.status(200).json({ ok: true, alreadyConfirmed: true });
    if (isBlockedForPayment(show, status)) return res.status(409).json({ error: `Cannot pay in status '${status}'` });

    const amountRub = getBookingAmount(show, booking);
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return res.status(409).json({ error: 'Invalid booking amount' });
    }

    const attemptId = genAttemptId();
    const orderNum = buildOrderNum(bookingId, attemptId);
    const now = Date.now();
    const linkExpiredAt = now + LINK_TTL_MS;
    const paymentHoldUntil = linkExpiredAt + GRACE_MS;

    // Фиксируем попытку с expectedAmount ДО выдачи ссылки — вебхук потом
    // сверяется именно с этим числом, а не пересчитывает цену заново.
    await fbPatch(`${cfg.bookingsNode}/${bookingId}/payments/${attemptId}`, {
      attemptId,
      orderNum,
      provider: 'prodamus',
      expectedAmount: amountRub,
      createdAt: now,
      linkExpiredAt,
      paymentHoldUntil,
      status: 'link_created'
    });
    await fbPatch(`${cfg.bookingsNode}/${bookingId}`, {
      status: show === 'secret' ? 'pending_payment' : 'waiting_payment',
      activePaymentAttemptId: attemptId
    });
    await markSeatsPaymentPending(show, booking, paymentHoldUntil);

    const paymentUrl = buildPaymentLink({
      orderNum,
      amountRub,
      description: `Билет на шоу «${cfg.label}» — Дмитрий Костюк`,
      show
    });

    return res.status(200).json({ ok: true, paymentUrl, orderNum, attemptId, linkExpiredAt });
  }

  // ── action=get_status: опрос статуса — истина только из Firebase ──
  if (action === 'get_status') {
    const show = String(query.show || body.show || '').toLowerCase();
    const bookingId = String(query.bookingId || body.bookingId || '').trim();
    const cfg = getShowConfig(show);
    if (!cfg) return res.status(400).json({ error: 'Invalid show' });
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

    const booking = await getBooking(show, bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    return res.status(200).json({
      ok: true,
      status: booking.status || '',
      paidConflict: Boolean(booking.paidConflict)
    });
  }

  // ── action=notify: вебхук Prodamus — единственное место, где бронь становится confirmed ──
  if (action === 'notify') {
    const sendText = (code, text) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(code).send(String(text || ''));
    };

    if (!isConfigured()) return sendText(503, 'DISABLED');

    const receivedSign = req.headers?.sign || req.headers?.Sign || '';
    if (!receivedSign) return sendText(400, 'NO_SIGNATURE');
    if (!verifyProdamusSignature(body, receivedSign, PRODAMUS_SECRET_KEY)) {
      return sendText(401, 'BAD_SIGNATURE');
    }

    const orderNum = String(body.order_num || '').trim();
    const orderId = String(body.order_id || '').trim(); // id платежа Prodamus — ключ идемпотентности
    const paymentStatus = String(body.payment_status || '').toLowerCase();
    if (!orderNum || !orderId) return sendText(400, 'BAD_ORDER');

    const { bookingId, attemptId } = parseOrderNum(orderNum);
    const show = String(body._param_show || '').toLowerCase();
    const cfg = getShowConfig(show);
    if (!cfg || !bookingId || !attemptId) return sendText(400, 'BAD_ORDER');

    // ── Двухфазная обработка: received → processed. Идемпотентность по order_id
    // Prodamus (не по order_num — на один заказ может прийти несколько доставок). ──
    const { isNew, isProcessed } = await recordReceived(orderId, body, { orderNum, bookingId });
    if (!isNew && isProcessed) return sendText(200, 'OK'); // уже обработан — доставка успешна
    if (!isNew && !isProcessed) {
      // Предыдущая попытка упала между received и processed — дорабатываем как обычно ниже.
    }

    const booking = await getBooking(show, bookingId);
    if (!booking) {
      await markProcessed(orderId, { status: 'processed', outcome: 'booking_not_found' });
      return sendText(200, 'OK'); // ретрай не поможет — брони уже нет
    }

    const attempt = booking?.payments?.[attemptId];
    const expectedAmount = Number(attempt?.expectedAmount ?? NaN);
    const receivedAmount = Number(body.sum ?? NaN);

    const isPaid = paymentStatus === 'success';
    const isDeclined = paymentStatus === 'order_canceled' || paymentStatus === 'order_denied';

    if (isPaid) {
      const amountMismatch = !Number.isFinite(expectedAmount)
        || !Number.isFinite(receivedAmount)
        || Math.round(expectedAmount) !== Math.round(receivedAmount);

      const currentStatus = getBookingStatus(booking);
      const alreadyConfirmed = isAlreadyConfirmed(currentStatus);

      if (amountMismatch && !alreadyConfirmed) {
        // Деньги пришли, но сумма не совпала с зафиксированной при создании
        // ссылки — НЕ подтверждаем автоматически. Место не отбираем у брони,
        // фиксируем конфликт, админ разбирает вручную (см. HANDOFF п.6.5).
        await fbPatch(`${cfg.bookingsNode}/${bookingId}`, {
          paidConflict: true,
          paidConflictReason: 'amount_mismatch',
          paidConflictAt: Date.now(),
          [`payments/${attemptId}/status`]: 'paid_amount_mismatch',
          [`payments/${attemptId}/receivedAmount`]: Number.isFinite(receivedAmount) ? receivedAmount : null,
          [`payments/${attemptId}/orderId`]: orderId
        });
        await markProcessed(orderId, { status: 'processed', outcome: 'paid_conflict_amount' });
        return sendText(200, 'OK');
      }

      // Другая попытка оплаты того же bookingId уже успешно подтвердила бронь —
      // деньги по этой попытке пришли на уже занятое (этой же бронью) место,
      // это не конфликт, просто дубль оплаты той же брони.
      if (alreadyConfirmed) {
        await fbPatch(`${cfg.bookingsNode}/${bookingId}/payments/${attemptId}`, {
          status: 'paid_already_confirmed',
          orderId
        });
        await markProcessed(orderId, { status: 'processed', outcome: 'already_confirmed' });
        return sendText(200, 'OK');
      }

      const result = await confirmBookingByShow(show, bookingId, {
        provider: 'prodamus',
        transactionId: orderId,
        paidAt: Date.now()
      });

      if (!result.ok) {
        // Не смогли подтвердить (например, гонка ETag) — НЕ помечаем processed,
        // чтобы повторная доставка вебхука дожала подтверждение.
        await fbPatch(`${cfg.bookingsNode}/${bookingId}/payments/${attemptId}`, {
          status: 'paid_confirm_failed',
          orderId,
          lastError: String(result.error || '')
        });
        return sendText(500, 'FAIL_CONFIRM');
      }

      await fbPatch(`${cfg.bookingsNode}/${bookingId}/payments/${attemptId}`, {
        status: 'paid_confirmed',
        orderId
      });
      await markProcessed(orderId, { status: 'processed', outcome: 'confirmed' });
      return sendText(200, 'OK');
    }

    if (isDeclined) {
      const currentStatus = getBookingStatus(booking);
      if (!isAlreadyConfirmed(currentStatus)) {
        await fbPatch(`${cfg.bookingsNode}/${bookingId}`, {
          status: show === 'secret' ? 'pending_payment' : 'new',
          [`payments/${attemptId}/status`]: 'declined',
          [`payments/${attemptId}/orderId`]: orderId,
          [`payments/${attemptId}/declineStatus`]: paymentStatus
        });
        await releaseSeatsToFree(show, booking);
      }
      await markProcessed(orderId, { status: 'processed', outcome: 'declined' });
      return sendText(200, 'OK');
    }

    // Неизвестный payment_status — фиксируем событие, но не трогаем бронь.
    await markProcessed(orderId, { status: 'processed', outcome: `unknown_status:${paymentStatus}` });
    return sendText(200, 'OK');
  }

  return res.status(404).json({ error: 'Unknown action' });
};

export { isConfigured as isProdamusEnabled };
