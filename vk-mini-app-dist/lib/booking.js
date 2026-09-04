// Booking/checkout contract layer for the VK Mini App.
// Builds the EXACT payloads the existing production endpoints already accept —
// one per show — so a Mini App order lands in the same system as a web order.
// No new records, no new server routes. Only additions: source='vk-mini-app'
// and an optional validated vkUserId, both accepted by the current contracts.
//
// Contracts (verified against the live web clients, 2026-09-03):
//   secret  : POST /api/book   { action:'book', show:'secret', bookingId, eventDate,
//                                seats:[{tableId,seatIdx,zone,key}], name, phone, email,
//                                vk, telegram, comment, tempBookingId, promoCode, source }
//             server generates clientKey; then POST /api/book {action:'tbank_init',bookingId,clientKey}
//   huligan : POST /api/huligan{ action:'fb_put', path:'huligan_bookings/<id>', tempBookingId,
//                                data:{ bookingId, clientKey(client), name, phone, email, eventDate,
//                                vk, telegram, comment, createdAt, status:'new', ticketType,
//                                originalPrice, finalPrice, promoCode, seats, source } }
//             then POST /api/huligan {action:'tbank_init', bookingId, clientKey}
//   matvey  : POST /api/matvey  { bookingId, eventDate, seats:[{key,zone}], name, phone, email,
//                                tempBookingId }  (+ source)
//             server returns clientKey; then POST /api/matvey {action:'tbank_init',bookingId,clientKey}

export const BOOKING_SOURCE = 'vk-mini-app';

// Random ids/keys usable in browser and Node test env.
function randomHex(bytes) {
  const cryptoObj = globalThis.crypto;
  const arr = new Uint8Array(bytes);
  if (cryptoObj && cryptoObj.getRandomValues) cryptoObj.getRandomValues(arr);
  else for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeBookingId(prefix) {
  return `${prefix}-${randomHex(4).toUpperCase()}`;
}

export function makeClientKey() {
  // ≥10 chars required by huligan validateBookingCreate; use 48 hex like the web.
  return randomHex(24);
}

function baseContact(contact = {}) {
  return {
    name: String(contact.name || ''),
    phone: String(contact.phone || ''),
    email: String(contact.email || ''),
    vk: String(contact.vk || ''),
    comment: String(contact.comment || ''),
  };
}

function eventDateString(dateObj) {
  if (!dateObj) return '';
  if (typeof dateObj === 'string') return dateObj;
  const parts = [dateObj.date, dateObj.time].filter(Boolean);
  return parts.join(' ');
}

// Attaches source + optional vkUserId without weakening the web flow:
// vkUserId is only added when it is a positive finite number.
function withVkContext(obj, vkUserId) {
  const out = { ...obj, source: BOOKING_SOURCE };
  const vk = Number(vkUserId);
  if (Number.isFinite(vk) && vk > 0) out.vkUserId = vk;
  return out;
}

/**
 * Builds the create-booking request for a show.
 * @param {'secret'|'huligan'|'matvey'} showId
 * @param {object} order { seats:[{key,zone,table?,seatIdx?}], contact, date, promoCode?, tempBookingId, prices? }
 * @param {object} [ctx] { vkUserId? }
 * @returns { path, body, meta } — meta carries client-generated ids where the contract needs them.
 */
export function buildCreateBookingRequest(showId, order, ctx = {}) {
  const contact = baseContact(order.contact);
  const eventDate = eventDateString(order.date);
  const tempBookingId = String(order.tempBookingId || '');
  const promoCode = order.promoCode || '';
  const seats = Array.isArray(order.seats) ? order.seats : [];

  if (showId === 'secret') {
    const bookingId = order.bookingId || makeBookingId('SEC');
    const body = withVkContext({
      action: 'book',
      show: 'secret',
      bookingId,
      eventDate,
      seats: seats.map((s) => ({
        tableId: parseInt(s.table, 10) || 0,
        seatIdx: parseInt(s.seatIdx, 10) || 0,
        zone: s.zone,
        key: s.key,
      })),
      ...contact,
      telegram: contact.vk,
      tempBookingId,
      promoCode,
    }, ctx.vkUserId);
    return { path: '/api/book', body, meta: { bookingId, clientKeyFrom: 'server' } };
  }

  if (showId === 'huligan') {
    const bookingId = order.bookingId || makeBookingId('HUL');
    const clientKey = order.clientKey || makeClientKey();
    const originalPrice = Number(order.originalPrice || 0);
    const finalPrice = Number(order.finalPrice != null ? order.finalPrice : originalPrice);
    const body = {
      action: 'fb_put',
      path: `huligan_bookings/${bookingId}`,
      tempBookingId,
      data: withVkContext({
        bookingId,
        clientKey,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        eventDate,
        vk: contact.vk,
        telegram: contact.vk,
        comment: contact.comment,
        createdAt: Date.now(),
        status: 'new',
        ticketType: order.ticketType || 'std',
        originalPrice,
        finalPrice,
        promoCode: promoCode || null,
        seats: seats.map((s) => ({
          table: s.table,
          zone: s.zone === 'standart' || s.zone === 'standard' ? 'std'
            : s.zone === 'econom' ? 'eco' : s.zone,
          seatNum: s.seatIdx != null ? s.seatIdx : s.seatNum,
          price: s.price,
          key: s.key,
        })),
      }, ctx.vkUserId),
    };
    return { path: '/api/huligan', body, meta: { bookingId, clientKey, clientKeyFrom: 'client' } };
  }

  if (showId === 'matvey') {
    const bookingId = order.bookingId || makeBookingId('MTV');
    const body = withVkContext({
      bookingId,
      eventDate,
      seats: seats.map((s) => ({ key: s.key, zone: s.zone })),
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      tempBookingId,
    }, ctx.vkUserId);
    return { path: '/api/matvey', body, meta: { bookingId, clientKeyFrom: 'server' } };
  }

  throw new Error(`Unknown show for booking: ${showId}`);
}

/**
 * Builds the T-Bank init request for a show. Same endpoint per show.
 * @returns { path, body }
 */
export function buildTbankInitRequest(showId, { bookingId, clientKey }) {
  if (showId === 'secret') return { path: '/api/book', body: { action: 'tbank_init', bookingId, clientKey } };
  if (showId === 'huligan') return { path: '/api/huligan', body: { action: 'tbank_init', bookingId, clientKey } };
  if (showId === 'matvey') return { path: '/api/matvey', body: { action: 'tbank_init', bookingId, clientKey } };
  throw new Error(`Unknown show for tbank init: ${showId}`);
}
