import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reserveSeats,
  submitBooking,
  openPayment,
} from '../vk-mini-app/lib/checkout.js';

const ORDER = {
  seats: [{ key: 't1_1', zone: 'vip', table: 'Стол 1', seatNum: 1, price: 1700 }],
  contact: { name: 'Иван', phone: '+79990001122', email: 'i@e.ru', vk: '' },
  date: { date: '31 октября 2026', time: '18:00' },
  tempBookingId: 'TEMP-ABC123',
  originalPrice: 1700,
  finalPrice: 1700,
};

test('reserveSeats calls /api/seats for huligan/secret and skips matvey', async () => {
  const calls = [];
  const client = { postJson: async (path, body) => { calls.push({ path, body }); return { ok: true }; } };
  const hul = await reserveSeats('huligan', client, { seats: ORDER.seats, tempBookingId: 'TEMP-X', vkUserId: 494075 });
  assert.equal(hul.ok, true);
  assert.equal(calls[0].path, '/api/seats');
  assert.equal(calls[0].body.action, 'reserve');
  assert.equal(calls[0].body.show, 'huligan');
  assert.equal(calls[0].body.vkUserId, 494075);

  const mtv = await reserveSeats('matvey', client, { seats: ORDER.seats, tempBookingId: 'TEMP-X' });
  assert.equal(mtv.skipped, true);
  assert.equal(calls.length, 1); // matvey did not call
});

test('submitBooking for huligan uses client clientKey and returns paymentUrl', async () => {
  const seen = [];
  const client = {
    postJson: async (path, body) => {
      seen.push({ path, body });
      if (body.action === 'fb_put') return { ok: true };
      if (body.action === 'tbank_init') return { ok: true, paymentUrl: 'https://securepay.tinkoff.ru/x' };
      throw new Error('unexpected ' + path);
    },
  };
  const res = await submitBooking('huligan', client, ORDER, { vkUserId: 494075 });
  assert.equal(res.ok, true);
  assert.equal(res.paymentUrl, 'https://securepay.tinkoff.ru/x');
  // huligan clientKey is client-generated and equals the one sent in data
  assert.equal(res.clientKey, seen[0].body.data.clientKey);
  // tbank_init used that bookingId+clientKey
  const init = seen.find((s) => s.body.action === 'tbank_init');
  assert.equal(init.body.bookingId, res.bookingId);
  assert.equal(init.body.clientKey, res.clientKey);
});

test('submitBooking for secret uses server clientKey', async () => {
  const client = {
    postJson: async (path, body) => {
      if (body.action === 'book') return { ok: true, clientKey: 'server-key-123' };
      if (body.action === 'tbank_init') {
        assert.equal(body.clientKey, 'server-key-123');
        return { ok: true, paymentUrl: 'https://pay/secret' };
      }
      throw new Error('unexpected');
    },
  };
  const res = await submitBooking('secret', client, ORDER);
  assert.equal(res.ok, true);
  assert.equal(res.clientKey, 'server-key-123');
  assert.equal(res.paymentUrl, 'https://pay/secret');
});

test('submitBooking fails cleanly when create errors', async () => {
  const client = { postJson: async () => { const e = new Error('boom'); e.code = 'http_error'; throw e; } };
  const res = await submitBooking('matvey', client, ORDER);
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'create');
});

test('submitBooking fails when server issues no clientKey', async () => {
  const client = { postJson: async (path, body) => (body.action === 'book' ? { ok: true } : { ok: true, paymentUrl: 'x' }) };
  const res = await submitBooking('secret', client, ORDER);
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'create');
  assert.equal(res.error.code, 'no_client_key');
});

test('submitBooking fails when tbank_init returns no paymentUrl', async () => {
  const client = {
    postJson: async (path, body) => {
      if (body.action === 'fb_put') return { ok: true };
      return { ok: false, error: 'acquiring not connected' };
    },
  };
  const res = await submitBooking('huligan', client, ORDER);
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'tbank_init');
  assert.equal(res.error.code, 'no_payment_url');
});

test('openPayment prefers VK Bridge, falls back to navigation', async () => {
  const bridgeCalls = [];
  const bridge = { send: async (method, params) => { bridgeCalls.push({ method, params }); } };
  const viaBridge = await openPayment('https://pay/1', { bridge });
  assert.equal(viaBridge.via, 'vk-bridge');
  assert.equal(bridgeCalls[0].method, 'VKWebAppOpenLink');
  assert.equal(bridgeCalls[0].params.url, 'https://pay/1');

  const loc = { href: '' };
  const viaLoc = await openPayment('https://pay/2', { windowLike: { location: loc } });
  assert.equal(viaLoc.via, 'location');
  assert.equal(loc.href, 'https://pay/2');
});

test('openPayment falls back to navigation when bridge throws', async () => {
  const bridge = { send: async () => { throw new Error('not available'); } };
  const loc = { href: '' };
  const res = await openPayment('https://pay/3', { bridge, windowLike: { location: loc } });
  assert.equal(res.via, 'location');
  assert.equal(loc.href, 'https://pay/3');
});
