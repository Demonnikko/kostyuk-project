import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOKING_SOURCE,
  makeBookingId,
  makeClientKey,
  buildCreateBookingRequest,
  buildTbankInitRequest,
} from '../vk-mini-app/lib/booking.js';

const ORDER = {
  seats: [{ key: 't1_1', zone: 'vip', table: 'Стол 1', seatIdx: 1, price: 1700 }],
  contact: { name: 'Иван', phone: '+79990001122', email: 'i@e.ru', vk: 'vk.com/id1', comment: '' },
  date: { date: '31 октября 2026', time: '18:00' },
  promoCode: '',
  tempBookingId: 'TEMP-ABC123',
  originalPrice: 1700,
  finalPrice: 1700,
};

test('ids and keys have the shapes the contracts require', () => {
  assert.match(makeBookingId('HUL'), /^HUL-[0-9A-F]{8}$/);
  const key = makeClientKey();
  assert.match(key, /^[0-9a-f]+$/);
  assert.ok(key.length >= 10, 'huligan validateBookingCreate needs clientKey >= 10 chars');
});

test('secret payload matches POST /api/book action=book contract', () => {
  const { path, body, meta } = buildCreateBookingRequest('secret', ORDER, { vkUserId: 494075 });
  assert.equal(path, '/api/book');
  assert.equal(body.action, 'book');
  assert.equal(body.show, 'secret');
  assert.equal(body.eventDate, '31 октября 2026 18:00');
  assert.deepEqual(body.seats[0], { tableId: 0, seatIdx: 1, zone: 'vip', key: 't1_1' });
  assert.equal(body.name, 'Иван');
  assert.equal(body.telegram, body.vk); // web parity: telegram mirrors vk
  assert.equal(body.tempBookingId, 'TEMP-ABC123');
  assert.equal(body.source, BOOKING_SOURCE);
  assert.equal(body.vkUserId, 494075);
  assert.equal(meta.clientKeyFrom, 'server'); // secret: server issues clientKey
  assert.match(meta.bookingId, /^SEC-/);
});

test('huligan payload matches POST /api/huligan action=fb_put contract', () => {
  const { path, body, meta } = buildCreateBookingRequest('huligan', ORDER, { vkUserId: 494075 });
  assert.equal(path, '/api/huligan');
  assert.equal(body.action, 'fb_put');
  assert.match(body.path, /^huligan_bookings\/HUL-/);
  assert.equal(body.tempBookingId, 'TEMP-ABC123');
  const d = body.data;
  assert.equal(d.bookingId, meta.bookingId);
  assert.equal(d.clientKey, meta.clientKey);
  assert.ok(d.clientKey.length >= 10);
  assert.equal(d.status, 'new');
  assert.equal(d.ticketType, 'std');
  assert.equal(d.eventDate, '31 октября 2026 18:00');
  assert.equal(d.finalPrice, 1700);
  assert.equal(d.seats[0].key, 't1_1');
  assert.equal(d.source, BOOKING_SOURCE);
  assert.equal(d.vkUserId, 494075);
  assert.equal(meta.clientKeyFrom, 'client'); // huligan: client generates clientKey
});

test('huligan maps legacy zone aliases to std/eco like the web client', () => {
  const order = { ...ORDER, seats: [
    { key: 't4_1', zone: 'standart', seatIdx: 16 },
    { key: 'c_1', zone: 'econom', seatIdx: 56 },
    { key: 't1_1', zone: 'vip', seatIdx: 1 },
  ] };
  const { body } = buildCreateBookingRequest('huligan', order);
  assert.deepEqual(body.data.seats.map((s) => s.zone), ['std', 'eco', 'vip']);
});

test('matvey payload matches POST /api/matvey contract', () => {
  const { path, body, meta } = buildCreateBookingRequest('matvey', ORDER, { vkUserId: 494075 });
  assert.equal(path, '/api/matvey');
  assert.equal(body.bookingId, meta.bookingId);
  assert.match(body.bookingId, /^MTV-/);
  assert.equal(body.eventDate, '31 октября 2026 18:00');
  assert.deepEqual(body.seats[0], { key: 't1_1', zone: 'vip' });
  assert.equal(body.tempBookingId, 'TEMP-ABC123');
  assert.equal(body.source, BOOKING_SOURCE);
  assert.equal(body.vkUserId, 494075);
  assert.equal(meta.clientKeyFrom, 'server');
});

test('vkUserId is omitted when absent or invalid (no web-flow weakening)', () => {
  const noVk = buildCreateBookingRequest('matvey', ORDER);
  assert.equal('vkUserId' in noVk.body, false);
  const badVk = buildCreateBookingRequest('matvey', ORDER, { vkUserId: 'nope' });
  assert.equal('vkUserId' in badVk.body, false);
  const zeroVk = buildCreateBookingRequest('secret', ORDER, { vkUserId: 0 });
  assert.equal('vkUserId' in zeroVk.body, false);
  // source is always present
  assert.equal(noVk.body.source, BOOKING_SOURCE);
});

test('every show still carries source=vk-mini-app', () => {
  assert.equal(buildCreateBookingRequest('secret', ORDER).body.source, BOOKING_SOURCE);
  assert.equal(buildCreateBookingRequest('huligan', ORDER).body.data.source, BOOKING_SOURCE);
  assert.equal(buildCreateBookingRequest('matvey', ORDER).body.source, BOOKING_SOURCE);
});

test('tbank init targets the right endpoint per show', () => {
  assert.deepEqual(buildTbankInitRequest('secret', { bookingId: 'SEC-1', clientKey: 'k' }),
    { path: '/api/book', body: { action: 'tbank_init', bookingId: 'SEC-1', clientKey: 'k' } });
  assert.deepEqual(buildTbankInitRequest('huligan', { bookingId: 'HUL-1', clientKey: 'k' }),
    { path: '/api/huligan', body: { action: 'tbank_init', bookingId: 'HUL-1', clientKey: 'k' } });
  assert.deepEqual(buildTbankInitRequest('matvey', { bookingId: 'MTV-1', clientKey: 'k' }),
    { path: '/api/matvey', body: { action: 'tbank_init', bookingId: 'MTV-1', clientKey: 'k' } });
});

test('unknown show throws for both builders', () => {
  assert.throws(() => buildCreateBookingRequest('nope', ORDER), /Unknown show/);
  assert.throws(() => buildTbankInitRequest('nope', { bookingId: 'x' }), /Unknown show/);
});
