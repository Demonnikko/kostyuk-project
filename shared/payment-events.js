/**
 * Журнал вебхуков Prodamus + идемпотентность.
 * Хранится в Firebase: payment_events/{provider}/{order_id} = { receivedAt, processedAt, payload, ... }
 *
 * Двухфазная обработка (см. HANDOFF.md раздел 6, пункт 4):
 *   received  — вебхук принят и подпись проверена, ещё не применён к брони/местам
 *   processed — бронь подтверждена/отклонена, событие закрыто
 * Если процесс упадёт между received и processed — повторный вебхук с тем же
 * order_id пройдёт заново (processedAt пуст), а не зависнет и не задвоится
 * (идемпотентность по order_id Prodamus, а не по order_num — на один order_num
 * шлюз может слать несколько доставок одного и того же события).
 */
import { fbGet, fbGetWithETag, fbConditionalPut, fbPut } from './firebase.js';

const EVENTS_ROOT = 'payment_events/prodamus';

function safeKey(orderId) {
  // Firebase-ключи не терпят . # $ [ ] /
  return String(orderId || '').replace(/[.#$\[\]\/]/g, '_');
}

/**
 * Атомарно фиксирует получение вебхука (защита от гонки двух одновременных
 * доставок одного и того же order_id). Возвращает { isNew, isProcessed, event }.
 * isNew=false + isProcessed=true  → уже обработан, вебхуку достаточно ответить 200 и выйти.
 * isNew=false + isProcessed=false → предыдущая попытка упала до processed, можно доработать.
 */
async function recordReceived(orderId, payload, meta = {}) {
  const key = safeKey(orderId);
  const path = `${EVENTS_ROOT}/${key}`;
  const { data: existing, etag } = await fbGetWithETag(path);

  if (existing) {
    return { isNew: false, isProcessed: Boolean(existing.processedAt), event: existing, key };
  }

  const event = {
    orderId: String(orderId),
    orderNum: String(meta.orderNum || payload?.order_num || ''),
    bookingId: String(meta.bookingId || ''),
    receivedAt: Date.now(),
    processedAt: null,
    status: 'received',
    paymentStatus: String(payload?.payment_status || ''),
    sum: payload?.sum != null ? String(payload.sum) : null,
    rawPayload: payload
  };

  try {
    const ok = await fbConditionalPut(path, event, etag || null);
    if (!ok) {
      // Кто-то записал параллельно между GET и PUT — читаем то, что победило.
      const { data: winner } = await fbGetWithETag(path);
      return { isNew: false, isProcessed: Boolean(winner?.processedAt), event: winner, key };
    }
    return { isNew: true, isProcessed: false, event, key };
  } catch (err) {
    if (err.message === 'ETAG_MISMATCH') {
      const { data: winner } = await fbGetWithETag(path);
      return { isNew: false, isProcessed: Boolean(winner?.processedAt), event: winner, key };
    }
    throw err;
  }
}

/** Помечает событие обработанным ТОЛЬКО после успешного применения к брони. */
async function markProcessed(orderId, outcome = {}) {
  const key = safeKey(orderId);
  const path = `${EVENTS_ROOT}/${key}`;
  const existing = await fbGet(path);
  await fbPut(path, {
    ...(existing || { orderId: String(orderId), receivedAt: Date.now() }),
    status: outcome.status || 'processed',
    processedAt: Date.now(),
    outcome: outcome.outcome || null,
    error: outcome.error || null
  });
}

export { recordReceived, markProcessed };
