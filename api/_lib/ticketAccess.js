const crypto = require('crypto');

const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const TICKET_PUBLIC_ORIGIN = process.env.TICKET_PUBLIC_ORIGIN || 'https://vk-tickets.vercel.app';
const TICKET_LINK_SECRET = process.env.TICKET_LINK_SECRET || '';

const BLOCKED_STATUSES = new Set(['cancelled', 'refunded', 'returned', 'deleted']);
const ALLOWED_STATUS = 'confirmed';

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function normalizeVersion(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function statusNorm(status) {
  return String(status || '').toLowerCase();
}

function isBlockedStatus(status) {
  return BLOCKED_STATUSES.has(statusNorm(status));
}

function canUseTicket(status) {
  return statusNorm(status) === ALLOWED_STATUS;
}

function signPayload(payloadB64) {
  if (!TICKET_LINK_SECRET) throw new Error('TICKET_LINK_SECRET is not configured');
  return crypto.createHmac('sha256', TICKET_LINK_SECRET).update(payloadB64).digest('base64url');
}

function makeTicketToken(bookingId, version, ttlHours = 24 * 45) {
  const exp = Date.now() + ttlHours * 60 * 60 * 1000;
  const payload = {
    bid: String(bookingId),
    v: normalizeVersion(version),
    exp
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyTicketToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, code: 'missing_token' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, code: 'invalid_token' };

  const [payloadB64, sig] = parts;
  const expectedSig = signPayload(payloadB64);

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, code: 'invalid_signature' };
  }

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64));
    if (!payload || !payload.bid || !payload.exp || !payload.v) {
      return { ok: false, code: 'invalid_payload' };
    }
    if (Date.now() > Number(payload.exp)) return { ok: false, code: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, code: 'invalid_payload' };
  }
}

function makeTicketUrl(bookingId, token) {
  return `${TICKET_PUBLIC_ORIGIN}/ticket.html?id=${encodeURIComponent(bookingId)}&tk=${encodeURIComponent(token)}`;
}

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    return await r.json();
  } catch {
    return null;
  }
}

async function buildTicketLink(bookingId, booking, ttlHours = 24 * 45) {
  const version = normalizeVersion(booking?.ticketLinkVersion);
  const token = makeTicketToken(bookingId, version, ttlHours);
  return {
    url: makeTicketUrl(bookingId, token),
    token,
    version,
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1000
  };
}

async function issueTicketLink(bookingId, ttlHours = 24 * 45) {
  const booking = await fbGet(`ticket_bookings/${bookingId}`);
  if (!booking) return { ok: false, status: 404, code: 'not_found' };
  if (isBlockedStatus(booking.status)) return { ok: false, status: 410, code: 'revoked' };
  if (!canUseTicket(booking.status)) return { ok: false, status: 409, code: 'not_ready' };

  const link = await buildTicketLink(bookingId, booking, ttlHours);
  return { ok: true, booking, ...link };
}

function validateTicketAccess(bookingId, token, booking) {
  if (!booking) return { ok: false, status: 404, code: 'not_found' };
  if (isBlockedStatus(booking.status)) return { ok: false, status: 410, code: 'revoked' };
  if (!canUseTicket(booking.status)) return { ok: false, status: 409, code: 'not_ready' };

  const verified = verifyTicketToken(token);
  if (!verified.ok) return { ok: false, status: 403, code: verified.code };

  if (String(verified.payload.bid) !== String(bookingId)) {
    return { ok: false, status: 403, code: 'id_mismatch' };
  }

  const currentVersion = normalizeVersion(booking.ticketLinkVersion);
  if (Number(verified.payload.v) !== currentVersion) {
    return { ok: false, status: 403, code: 'link_invalidated' };
  }

  return { ok: true };
}

module.exports = {
  fbGet,
  issueTicketLink,
  buildTicketLink,
  validateTicketAccess
};
