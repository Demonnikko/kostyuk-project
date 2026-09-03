import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHOW_ENDPOINTS,
  normalizeSeats,
  extractShowConfig,
  loadShowData,
} from '../vk-mini-app/lib/show-data.js';

// Real config shapes captured from production endpoints (2026-09-03):
const SECRET_CONFIG = {
  payment: {}, prices: { vip: 1800 },
  show: { address: 'Ярославль, ул. Нахимсона 21', date: '31 октября 2026', time: '18:00', title: '', venue: 'Арт-площадка "Лампа"' },
  metrics: {},
};
const HULIGAN_CONFIG = {
  huliganShow: { address: 'Ярославль', date: '19 сентября 2026', time: '18:00', title: 'ХУЛИgan', venue: 'Арт-площадка "Лампа"' },
  prices: { vip: 1700 }, metrics: {},
};
const MATVEY_CONFIG = {
  show: { address: 'Ярославль', date: '21 ноября 2026', time: '15:00', title: 'Спасти Матвея', venue: 'Арт-площадка "Лампа"' },
  prices: {}, salesPaused: false, metrics: {},
};

test('endpoints map each show to its real read-only contracts', () => {
  assert.equal(SHOW_ENDPOINTS.secret.config, '/api/seats?type=config&show=secret');
  assert.equal(SHOW_ENDPOINTS.secret.seats, '/api/seats?show=secret');
  assert.equal(SHOW_ENDPOINTS.huligan.config, '/api/seats?type=config&section=huligan');
  assert.equal(SHOW_ENDPOINTS.huligan.seats, '/api/seats?show=huligan');
  assert.equal(SHOW_ENDPOINTS.matvey.config, '/api/matvey-seats?type=config');
  assert.equal(SHOW_ENDPOINTS.matvey.seats, '/api/matvey-seats');
});

test('normalizeSeats derives occupancy from server status only', () => {
  const seats = normalizeSeats({
    t1_1: { status: 'taken' },
    t1_2: { status: 'reserved' },
    t1_3: { status: 'available' },
    t1_4: {},
  });
  assert.equal(seats.t1_1.taken, true);
  assert.equal(seats.t1_2.taken, true);
  assert.equal(seats.t1_3.taken, false);
  assert.equal(seats.t1_4.taken, false);
  assert.equal(seats.t1_4.status, 'available');
});

test('normalizeSeats tolerates empty and malformed input', () => {
  assert.deepEqual(normalizeSeats(null), {});
  assert.deepEqual(normalizeSeats(undefined), {});
  assert.deepEqual(normalizeSeats('nope'), {});
});

test('extractShowConfig reads the right nested show for each show', () => {
  assert.deepEqual(extractShowConfig('secret', SECRET_CONFIG).show, SECRET_CONFIG.show);
  assert.deepEqual(extractShowConfig('huligan', HULIGAN_CONFIG).show, HULIGAN_CONFIG.huliganShow);
  assert.deepEqual(extractShowConfig('matvey', MATVEY_CONFIG).show, MATVEY_CONFIG.show);
});

test('loadShowData fetches config+seats and normalizes for huligan', async () => {
  const client = {
    getJson: async (path) => {
      if (path === SHOW_ENDPOINTS.huligan.config) return HULIGAN_CONFIG;
      if (path === SHOW_ENDPOINTS.huligan.seats) return { t1_3: { status: 'taken' } };
      throw new Error('unexpected path ' + path);
    },
  };
  const result = await loadShowData('huligan', client);
  assert.equal(result.ok, true);
  assert.equal(result.config.show.date, '19 сентября 2026');
  assert.equal(result.seats.t1_3.taken, true);
});

test('loadShowData returns a clean error object when the API fails', async () => {
  const client = {
    getJson: async () => {
      const e = new Error('Network request failed');
      e.code = 'network_error';
      throw e;
    },
  };
  const result = await loadShowData('secret', client);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'network_error');
  assert.deepEqual(result.seats, {});
});

test('loadShowData rejects an unknown show id without calling the API', async () => {
  let called = false;
  const client = { getJson: async () => { called = true; return {}; } };
  const result = await loadShowData('not-a-show', client);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unknown_show');
  assert.equal(called, false);
});
