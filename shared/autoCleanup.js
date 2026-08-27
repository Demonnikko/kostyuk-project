import {  fbGet, fbPatch, fbPut  } from './firebase.js';

const SECRET_RESERVE_MS = Number(process.env.SECRET_RESERVE_MS || process.env.TEMP_RESERVE_MS || 10 * 60 * 1000);
const HULIGAN_RESERVE_MS = Number(process.env.HULIGAN_RESERVE_MS || 10 * 60 * 1000);
const CLEANUP_INTERVAL_MS = Number(process.env.AUTO_CLEANUP_INTERVAL_MS || 45 * 1000);

const _state = {
  secret: { lastRunAt: 0, running: false },
  huligan: { lastRunAt: 0, running: false }
};

function nowTs() {
  return Date.now();
}

function canRun(scope) {
  const st = _state[scope];
  if (!st || st.running) return false;
  return (nowTs() - st.lastRunAt) >= CLEANUP_INTERVAL_MS;
}

/**
 * true, если у брони есть активная попытка оплаты Prodamus, чей grace-период
 * (linkExpiredAt + 15 мин, см. api/_endpoints/prodamus.js) ещё не истёк.
 * Пока это так, автоочистка НЕ должна отменять бронь/место — иначе можно
 * отменить бронь прямо во время того как покупатель уже платит по ссылке.
 */
function hasActivePaymentHold(booking, now) {
  const attemptId = booking?.activePaymentAttemptId;
  if (!attemptId) return false;
  const attempt = booking?.payments?.[attemptId];
  const holdUntil = Number(attempt?.paymentHoldUntil || 0);
  return holdUntil > now;
}

async function releaseSecretSeats(bookingIds) {
  if (!bookingIds || !bookingIds.size) return 0;
  const seats = await fbGet('ticket_seats') || {};
  let released = 0;
  const jobs = [];
  for (const [seatKey, seatData] of Object.entries(seats)) {
    const bid = String(seatData?.bookingId || '').trim();
    if (!bid || !bookingIds.has(bid)) continue;
    jobs.push(
      fbPut(`ticket_seats/${seatKey}`, { status: 'available' })
        .then(() => { released += 1; })
        .catch(() => {})
    );
  }
  if (jobs.length) await Promise.all(jobs);
  return released;
}

async function runSecretAutoCleanup() {
  if (!canRun('secret')) return { ok: true, skipped: true };
  const st = _state.secret;
  st.running = true;
  st.lastRunAt = nowTs();
  try {
    const bookings = await fbGet('ticket_bookings') || {};
    const now = nowTs();
    const expired = [];
    for (const [id, b] of Object.entries(bookings)) {
      const status = String(b?.status || '').toLowerCase();
      const createdAt = Number(b?.createdAt || 0);
      if (status !== 'pending_payment') continue;
      if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
      if (Number(b?.paidAt || 0) > 0) continue;
      if ((now - createdAt) < SECRET_RESERVE_MS) continue;
      if (hasActivePaymentHold(b, now)) continue;
      expired.push(id);
    }
    if (!expired.length) return { ok: true, cancelled: 0, released: 0 };

    const cancelledSet = new Set();
    for (const id of expired) {
      const latest = await fbGet(`ticket_bookings/${id}`);
      if (!latest) continue;
      const status = String(latest?.status || '').toLowerCase();
      const createdAt = Number(latest?.createdAt || 0);
      if (status !== 'pending_payment') continue;
      if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
      if (Number(latest?.paidAt || 0) > 0) continue;
      if ((now - createdAt) < SECRET_RESERVE_MS) continue;
      if (hasActivePaymentHold(latest, now)) continue;
      await fbPatch(`ticket_bookings/${id}`, {
        status: 'cancelled',
        cancelledAt: now,
        autoCancelledAt: now,
        cancelReason: 'Автоотмена: истекло 10 минут на оплату',
        ticketLinkVersion: Number(latest.ticketLinkVersion || 1) + 1
      }).catch(() => {});
      cancelledSet.add(id);
    }

    const released = await releaseSecretSeats(cancelledSet);
    return { ok: true, cancelled: cancelledSet.size, released };
  } catch {
    return { ok: false };
  } finally {
    st.running = false;
  }
}

async function releaseHuliganSeats(bookingIds) {
  if (!bookingIds || !bookingIds.size) return 0;
  const seats = await fbGet('huligan_seats') || {};
  let released = 0;
  const jobs = [];
  for (const [seatKey, seatData] of Object.entries(seats)) {
    const bid = String(seatData?.bookingId || '').trim();
    if (!bid || !bookingIds.has(bid)) continue;
    jobs.push(
      fbPut(`huligan_seats/${seatKey}`, { status: 'available' })
        .then(() => { released += 1; })
        .catch(() => {})
    );
  }
  if (jobs.length) await Promise.all(jobs);
  return released;
}

async function runHuliganAutoCleanup() {
  if (!canRun('huligan')) return { ok: true, skipped: true };
  const st = _state.huligan;
  st.running = true;
  st.lastRunAt = nowTs();
  try {
    const all = await fbGet('huligan_bookings') || {};
    const now = nowTs();
    let cancelled = 0;
    const cancelledSet = new Set();
    for (const [id, b] of Object.entries(all)) {
      const status = String(b?.status || '').toLowerCase();
      const createdAt = Number(b?.createdAt || 0);
      if (status !== 'new' && status !== 'waiting_payment') continue;
      if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
      if (Number(b?.paidAt || 0) > 0) continue;
      if ((now - createdAt) < HULIGAN_RESERVE_MS) continue;
      if (hasActivePaymentHold(b, now)) continue;

      const latest = await fbGet(`huligan_bookings/${id}`);
      if (!latest) continue;
      const latestStatus = String(latest?.status || '').toLowerCase();
      const latestCreatedAt = Number(latest?.createdAt || 0);
      if (latestStatus !== 'new' && latestStatus !== 'waiting_payment') continue;
      if (!Number.isFinite(latestCreatedAt) || latestCreatedAt <= 0) continue;
      if (Number(latest?.paidAt || 0) > 0) continue;
      if ((now - latestCreatedAt) < HULIGAN_RESERVE_MS) continue;
      if (hasActivePaymentHold(latest, now)) continue;

      await fbPatch(`huligan_bookings/${id}`, {
        status: 'cancelled',
        cancelledAt: now,
        autoCancelledAt: now,
        cancelReason: 'Автоотмена: истекло 10 минут на оплату'
      }).catch(() => {});
      cancelled += 1;
      cancelledSet.add(id);
    }
    const released = await releaseHuliganSeats(cancelledSet);
    return { ok: true, cancelled, released };
  } catch {
    return { ok: false };
  } finally {
    st.running = false;
  }
}

export {
  runSecretAutoCleanup,
  runHuliganAutoCleanup
};
