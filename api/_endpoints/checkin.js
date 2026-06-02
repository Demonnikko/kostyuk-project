import crypto from 'crypto';
import {  fbGet, fbPut  } from '../_lib/firebase';
import {  setCors  } from '../_lib/cors';
import {  isAdminAuthorized  } from '../_lib/adminAuth.js';
import {  validateTicketAccess  } from '../_lib/ticketAccess';

const TICKET_LINK_SECRET = String(process.env.TICKET_LINK_SECRET || '').trim();
const MAX_HISTORY = 200;

const BLOCKED_STATUSES = new Set(['cancelled', 'refunded', 'returned', 'deleted']);
const CONFIRMED_STATUS = 'confirmed';
const BOOKING_ID_RE = /^[A-Z0-9_-]{3,60}$/i;

function normalizeShow(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'secret') return 'secret';
  if (v === 'huligan') return 'huligan';
  if (v === 'all') return 'all';
  if (v === 'auto' || !v) return 'auto';
  return null;
}

function showToBookingPath(show) {
  return show === 'huligan' ? 'huligan_bookings' : 'ticket_bookings';
}

function statusNorm(status) {
  return String(status || '').trim().toLowerCase();
}

function nowTs() {
  return Date.now();
}

function eventKey(prefix = 'e') {
  const t = nowTs().toString(36);
  const r = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${t}_${r}`;
}

function safeString(raw, max = 120) {
  return String(raw || '').trim().slice(0, max);
}

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payloadB64) {
  if (!TICKET_LINK_SECRET) return '';
  return crypto.createHmac('sha256', TICKET_LINK_SECRET).update(payloadB64).digest('base64url');
}

function verifyHuliganToken(token, bookingId) {
  if (!TICKET_LINK_SECRET) return { ok: false, code: 'secret_missing' };
  if (!token || typeof token !== 'string') return { ok: false, code: 'token_missing' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, code: 'token_format' };
  const [payloadB64, sig] = parts;
  const expectedSig = signPayload(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return { ok: false, code: 'bad_sig' };
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return { ok: false, code: 'bad_sig' };
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64));
    if (!payload || !payload.bid || !payload.exp) return { ok: false, code: 'token_payload' };
    if (String(payload.bid) !== String(bookingId)) return { ok: false, code: 'id_mismatch' };
    if (nowTs() > Number(payload.exp)) return { ok: false, code: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, code: 'token_parse' };
  }
}

function parseTicketPayload(rawPayload) {
  const payload = String(rawPayload || '').trim();
  if (!payload) return null;

  if (/^https?:\/\//i.test(payload)) {
    try {
      const url = new URL(payload);
      const pathname = String(url.pathname || '').toLowerCase();
      const id = safeString(url.searchParams.get('id') || '', 80);
      const tk = safeString(url.searchParams.get('tk') || '', 800);

      let showFromUrl = '';
      if (pathname.includes('huligan-ticket') || pathname.includes('/huligan')) showFromUrl = 'huligan';
      else if (pathname.includes('ticket')) showFromUrl = 'secret';

      return {
        kind: 'url',
        raw: payload,
        id,
        tk,
        showFromUrl
      };
    } catch {
      return { kind: 'text', raw: payload };
    }
  }

  return { kind: 'text', raw: payload };
}

function bookingView(show, bookingId, booking) {
  const seatCount = Array.isArray(booking?.seats) ? booking.seats.length : 0;
  return {
    show,
    bookingId: String(bookingId || ''),
    status: String(booking?.status || ''),
    name: String(booking?.name || ''),
    phone: String(booking?.phone || ''),
    ticketType: String(booking?.ticketType || ''),
    ticketNumber: String(booking?.ticketNumber || ''),
    seats: Array.isArray(booking?.seats) ? booking.seats : [],
    seatCount,
    createdAt: Number(booking?.createdAt || 0) || null,
    confirmedAt: Number(booking?.confirmedAt || 0) || null,
    total: Number(booking?.total || 0),
    discountedTotal: Number(booking?.discountedTotal || booking?.finalPrice || booking?.total || 0)
  };
}

function statePath(show, bookingId) {
  return `ticket_checkin/state/${show}/${bookingId}`;
}

function eventPath(show, id) {
  return `ticket_checkin/events/${show}/${id}`;
}

async function writeEvent(show, event) {
  const id = eventKey('evt');
  await fbPut(eventPath(show, id), {
    id,
    ...event,
    ts: nowTs()
  });
}

async function getCheckinState(show, bookingId) {
  const data = await fbGet(statePath(show, bookingId));
  if (!data || typeof data !== 'object') return null;
  return {
    show,
    bookingId,
    checkedIn: Boolean(data.checkedIn),
    checkedInAt: Number(data.checkedInAt || 0) || null,
    checkedOutAt: Number(data.checkedOutAt || 0) || null,
    checkinsCount: Number(data.checkinsCount || 0),
    duplicateScans: Number(data.duplicateScans || 0),
    lastSource: String(data.lastSource || ''),
    lastOperator: String(data.lastOperator || ''),
    updatedAt: Number(data.updatedAt || 0) || null
  };
}

async function markCheckedIn({
  show,
  bookingId,
  booking,
  source,
  operator,
  payloadRaw,
  tokenVerified
}) {
  const current = (await fbGet(statePath(show, bookingId))) || {};
  const ts = nowTs();
  const nextCount = Number(current.checkinsCount || 0) + 1;

  const next = {
    show,
    bookingId,
    checkedIn: true,
    checkedInAt: ts,
    checkedOutAt: null,
    checkinsCount: nextCount,
    duplicateScans: Number(current.duplicateScans || 0),
    lastSource: source,
    lastOperator: operator || '',
    tokenVerified: Boolean(tokenVerified),
    payloadRaw: safeString(payloadRaw, 1024),
    ticketNumber: safeString(booking?.ticketNumber || '', 60),
    name: safeString(booking?.name || '', 120),
    ticketType: safeString(booking?.ticketType || '', 40),
    updatedAt: ts
  };

  await fbPut(statePath(show, bookingId), next);
  await writeEvent(show, {
    type: 'admit',
    bookingId,
    source,
    operator: operator || '',
    tokenVerified: Boolean(tokenVerified),
    name: safeString(booking?.name || '', 120),
    ticketNumber: safeString(booking?.ticketNumber || '', 60),
    status: safeString(booking?.status || '', 30)
  });
  return next;
}

async function markDuplicate({
  show,
  bookingId,
  booking,
  source,
  operator,
  payloadRaw
}) {
  const current = (await fbGet(statePath(show, bookingId))) || {};
  const ts = nowTs();
  const dupCount = Number(current.duplicateScans || 0) + 1;
  const next = {
    ...current,
    show,
    bookingId,
    checkedIn: Boolean(current.checkedIn),
    duplicateScans: dupCount,
    lastSource: source,
    lastOperator: operator || '',
    payloadRaw: safeString(payloadRaw, 1024),
    updatedAt: ts
  };
  await fbPut(statePath(show, bookingId), next);
  await writeEvent(show, {
    type: 'duplicate',
    bookingId,
    source,
    operator: operator || '',
    name: safeString(booking?.name || '', 120),
    ticketNumber: safeString(booking?.ticketNumber || '', 60),
    status: safeString(booking?.status || '', 30)
  });
  return next;
}

async function markUndo({ show, bookingId, operator, reason }) {
  const current = (await fbGet(statePath(show, bookingId))) || {};
  const ts = nowTs();
  const next = {
    ...current,
    show,
    bookingId,
    checkedIn: false,
    checkedOutAt: ts,
    lastOperator: operator || '',
    undoReason: safeString(reason || '', 300),
    updatedAt: ts
  };
  await fbPut(statePath(show, bookingId), next);
  await writeEvent(show, {
    type: 'undo',
    bookingId,
    operator: operator || '',
    reason: safeString(reason || '', 300)
  });
  return next;
}

async function getBooking(show, bookingId) {
  const path = `${showToBookingPath(show)}/${bookingId}`;
  const booking = await fbGet(path);
  if (!booking || typeof booking !== 'object') return null;
  return booking;
}

async function findHuliganByTicketNumber(ticketNumber) {
  const norm = String(ticketNumber || '').trim().toUpperCase();
  if (!norm) return null;
  const all = (await fbGet('huligan_bookings')) || {};
  for (const [id, booking] of Object.entries(all)) {
    if (String(booking?.ticketNumber || '').trim().toUpperCase() === norm) {
      return { bookingId: id, booking };
    }
  }
  return null;
}

function classifyStatus(status) {
  const st = statusNorm(status);
  if (BLOCKED_STATUSES.has(st)) return 'revoked';
  if (st !== CONFIRMED_STATUS) return 'not_confirmed';
  return 'ok';
}

async function resolveBookingFromText(rawText, showHint) {
  const query = safeString(rawText, 120).toUpperCase();
  if (!query) return null;

  const canUseAsBookingId = BOOKING_ID_RE.test(query);
  const preferredShows = showHint === 'auto' ? ['secret', 'huligan'] : [showHint];

  if (canUseAsBookingId) {
    for (const show of preferredShows) {
      const booking = await getBooking(show, query);
      if (booking) return { show, bookingId: query, booking, sourceType: 'manual_booking_id' };
    }
  }

  if (showHint === 'huligan' || showHint === 'auto') {
    const found = await findHuliganByTicketNumber(query);
    if (found) {
      return {
        show: 'huligan',
        bookingId: found.bookingId,
        booking: found.booking,
        sourceType: 'manual_ticket_number'
      };
    }
  }

  return null;
}

async function resolveScan(payloadRaw, showHint = 'auto') {
  const parsed = parseTicketPayload(payloadRaw);
  if (!parsed) {
    return { ok: false, state: 'invalid', reason: 'empty_payload' };
  }

  if (parsed.kind === 'url') {
    if (!parsed.id) {
      return { ok: false, state: 'invalid', reason: 'no_booking_id_in_qr' };
    }

    let show = parsed.showFromUrl || '';
    if (!show || showHint !== 'auto') show = showHint === 'auto' ? show : showHint;
    if (!show || show === 'auto') {
      // Fallback: пробуем сначала Секрет, потом Хулиган
      const sBooking = await getBooking('secret', parsed.id);
      if (sBooking) show = 'secret';
      else show = 'huligan';
    }

    const booking = await getBooking(show, parsed.id);
    if (!booking) {
      return { ok: false, state: 'not_found', reason: 'booking_not_found', show, bookingId: parsed.id };
    }

    const statusClass = classifyStatus(booking.status);
    if (statusClass === 'revoked') {
      return { ok: false, state: 'revoked', show, bookingId: parsed.id, booking };
    }
    if (statusClass === 'not_confirmed') {
      return { ok: false, state: 'not_confirmed', show, bookingId: parsed.id, booking };
    }

    if (parsed.tk) {
      if (show === 'secret') {
        const check = validateTicketAccess(parsed.id, parsed.tk, booking);
        if (!check.ok) {
          return { ok: false, state: 'invalid', reason: check.code || 'secret_token_invalid', show, bookingId: parsed.id, booking };
        }
        return {
          ok: true,
          show,
          bookingId: parsed.id,
          booking,
          sourceType: 'qr',
          tokenVerified: true
        };
      }

      const check = verifyHuliganToken(parsed.tk, parsed.id);
      if (!check.ok) {
        return { ok: false, state: 'invalid', reason: check.code || 'huligan_token_invalid', show, bookingId: parsed.id, booking };
      }
      const currentVersion = Number(booking.ticketLinkVersion || 1);
      const tokenVersion = Number(check.payload?.v || 1);
      if (tokenVersion !== currentVersion) {
        return { ok: false, state: 'invalid', reason: 'link_invalidated', show, bookingId: parsed.id, booking };
      }
      return {
        ok: true,
        show,
        bookingId: parsed.id,
        booking,
        sourceType: 'qr',
        tokenVerified: true
      };
    }

    // URL без токена — это слабая проверка
    return {
      ok: true,
      show,
      bookingId: parsed.id,
      booking,
      sourceType: 'url_without_token',
      tokenVerified: false
    };
  }

  const found = await resolveBookingFromText(parsed.raw, showHint);
  if (!found) return { ok: false, state: 'not_found', reason: 'manual_not_found' };

  const statusClass = classifyStatus(found.booking.status);
  if (statusClass === 'revoked') {
    return { ok: false, state: 'revoked', show: found.show, bookingId: found.bookingId, booking: found.booking };
  }
  if (statusClass === 'not_confirmed') {
    return { ok: false, state: 'not_confirmed', show: found.show, bookingId: found.bookingId, booking: found.booking };
  }

  return {
    ok: true,
    show: found.show,
    bookingId: found.bookingId,
    booking: found.booking,
    sourceType: found.sourceType,
    tokenVerified: false
  };
}

async function gatherStats(show) {
  const shows = show === 'all' ? ['secret', 'huligan'] : [show];
  const result = { shows: {}, totalConfirmed: 0, totalCheckedIn: 0, totalPending: 0 };

  for (const s of shows) {
    const bookings = (await fbGet(showToBookingPath(s))) || {};
    const states = (await fbGet(`ticket_checkin/state/${s}`)) || {};
    const confirmedIds = Object.entries(bookings)
      .filter(([, booking]) => statusNorm(booking?.status) === CONFIRMED_STATUS)
      .map(([id]) => id);

    const checkedInCount = confirmedIds.filter((id) => Boolean(states?.[id]?.checkedIn)).length;
    const confirmedCount = confirmedIds.length;
    const pendingCount = Math.max(0, confirmedCount - checkedInCount);

    result.shows[s] = {
      confirmed: confirmedCount,
      checkedIn: checkedInCount,
      pending: pendingCount
    };
    result.totalConfirmed += confirmedCount;
    result.totalCheckedIn += checkedInCount;
    result.totalPending += pendingCount;
  }

  result.generatedAt = nowTs();
  return result;
}

async function gatherHistory(show, limit) {
  const shows = show === 'all' ? ['secret', 'huligan'] : [show];
  const all = [];

  for (const s of shows) {
    const events = (await fbGet(`ticket_checkin/events/${s}`)) || {};
    for (const value of Object.values(events)) {
      if (!value || typeof value !== 'object') continue;
      all.push({
        show: s,
        id: String(value.id || ''),
        type: String(value.type || ''),
        ts: Number(value.ts || 0),
        bookingId: String(value.bookingId || ''),
        name: String(value.name || ''),
        ticketNumber: String(value.ticketNumber || ''),
        source: String(value.source || ''),
        operator: String(value.operator || ''),
        reason: String(value.reason || ''),
        tokenVerified: Boolean(value.tokenVerified)
      });
    }
  }

  return all
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.min(MAX_HISTORY, Math.max(1, Number(limit || 50))));
}

export default async (req, res) => {
  setCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!(await isAdminAuthorized(req, req.body || {}))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    if (req.method === 'GET') {
      const action = safeString(req.query?.action, 40).toLowerCase();
      if (action === 'stats') {
        const show = normalizeShow(req.query?.show || 'all');
        if (!show || show === 'auto') return res.status(400).json({ error: 'Invalid show' });
        const data = await gatherStats(show);
        return res.status(200).json({ ok: true, ...data });
      }

      if (action === 'history') {
        const show = normalizeShow(req.query?.show || 'all');
        if (!show || show === 'auto') return res.status(400).json({ error: 'Invalid show' });
        const limit = Number(req.query?.limit || 50);
        const items = await gatherHistory(show, limit);
        return res.status(200).json({ ok: true, items });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }
    const action = safeString(body?.action, 40).toLowerCase();

    if (action === 'scan') {
      const payload = safeString(body?.payload, 2048);
      const showHint = normalizeShow(body?.showHint || 'auto');
      const operator = safeString(body?.operator, 80);
      if (!payload) return res.status(400).json({ error: 'Missing payload' });
      if (!showHint || showHint === 'all') return res.status(400).json({ error: 'Invalid showHint' });

      const resolved = await resolveScan(payload, showHint);
      if (!resolved.ok) {
        return res.status(200).json({
          ok: true,
          state: resolved.state || 'invalid',
          reason: resolved.reason || '',
          show: resolved.show || null,
          bookingId: resolved.bookingId || '',
          booking: resolved.booking ? bookingView(resolved.show, resolved.bookingId, resolved.booking) : null
        });
      }

      const { show, bookingId, booking, sourceType, tokenVerified } = resolved;
      const current = await getCheckinState(show, bookingId);
      const source = sourceType || 'scan';

      if (current?.checkedIn) {
        const dupState = await markDuplicate({
          show,
          bookingId,
          booking,
          source,
          operator,
          payloadRaw: payload
        });
        return res.status(200).json({
          ok: true,
          state: 'duplicate',
          show,
          booking: bookingView(show, bookingId, booking),
          checkin: dupState,
          tokenVerified: Boolean(tokenVerified)
        });
      }

      const checkinState = await markCheckedIn({
        show,
        bookingId,
        booking,
        source,
        operator,
        payloadRaw: payload,
        tokenVerified
      });

      return res.status(200).json({
        ok: true,
        state: tokenVerified ? 'admitted' : 'admitted_manual',
        show,
        booking: bookingView(show, bookingId, booking),
        checkin: checkinState,
        tokenVerified: Boolean(tokenVerified)
      });
    }

    if (action === 'undo') {
      const show = normalizeShow(body?.show);
      const bookingId = safeString(body?.bookingId, 80);
      const operator = safeString(body?.operator, 80);
      const reason = safeString(body?.reason, 300);
      if (!show || show === 'all' || show === 'auto') return res.status(400).json({ error: 'Invalid show' });
      if (!BOOKING_ID_RE.test(bookingId)) return res.status(400).json({ error: 'Invalid bookingId' });

      const booking = await getBooking(show, bookingId);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });

      const prev = await getCheckinState(show, bookingId);
      if (!prev?.checkedIn) {
        return res.status(200).json({
          ok: true,
          state: 'noop',
          show,
          booking: bookingView(show, bookingId, booking),
          checkin: prev
        });
      }

      const next = await markUndo({ show, bookingId, operator, reason });
      return res.status(200).json({
        ok: true,
        state: 'undone',
        show,
        booking: bookingView(show, bookingId, booking),
        checkin: next
      });
    }

    if (action === 'lookup') {
      const payload = safeString(body?.payload, 2048);
      const showHint = normalizeShow(body?.showHint || 'auto');
      if (!payload) return res.status(400).json({ error: 'Missing payload' });
      if (!showHint || showHint === 'all') return res.status(400).json({ error: 'Invalid showHint' });

      const resolved = await resolveScan(payload, showHint);
      if (!resolved.ok) {
        return res.status(200).json({
          ok: true,
          found: false,
          state: resolved.state || 'invalid',
          reason: resolved.reason || '',
          show: resolved.show || null,
          bookingId: resolved.bookingId || '',
          booking: resolved.booking ? bookingView(resolved.show, resolved.bookingId, resolved.booking) : null
        });
      }

      const checkin = await getCheckinState(resolved.show, resolved.bookingId);
      return res.status(200).json({
        ok: true,
        found: true,
        state: checkin?.checkedIn ? 'duplicate' : 'ready',
        tokenVerified: Boolean(resolved.tokenVerified),
        sourceType: resolved.sourceType,
        show: resolved.show,
        booking: bookingView(resolved.show, resolved.bookingId, resolved.booking),
        checkin
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[checkin] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
