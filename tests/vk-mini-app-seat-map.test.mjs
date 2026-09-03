import assert from 'node:assert/strict';
import test from 'node:test';

import { seatLabel, selectionTotal } from '../vk-mini-app/lib/seat-map.js';

test('seatLabel prefers an explicit label (matvey)', () => {
  assert.equal(seatLabel({ label: 'Ряд 5 · место 45', seatNum: 45 }), 'Ряд 5 · место 45');
});

test('seatLabel derives from table for numbered tables (huligan/secret)', () => {
  assert.equal(seatLabel({ table: 5, seatNum: 20 }), 'Стол 5, место 20');
});

test('seatLabel handles the bar and string tables', () => {
  assert.equal(seatLabel({ table: 'Бар', seatNum: 70 }), 'Бар, место 70');
  assert.equal(seatLabel({ table: 'Стул', seatNum: 60 }), 'Стул, место 60');
});

test('seatLabel falls back to just the seat number', () => {
  assert.equal(seatLabel({ seatNum: 12 }), 'Место 12');
});

test('selectionTotal sums zone prices from the layout', () => {
  const zones = { vip: { price: 1700 }, econom: { price: 1100 }, bar: { price: 800 } };
  const selected = [
    { key: 't1_1', zone: 'vip' },
    { key: 'c_1', zone: 'econom' },
    { key: 'bar_1', zone: 'bar' },
  ];
  assert.equal(selectionTotal(selected, zones), 1700 + 1100 + 800);
});

test('selectionTotal is 0 for empty selection and unknown zones', () => {
  assert.equal(selectionTotal([], { vip: { price: 1700 } }), 0);
  assert.equal(selectionTotal([{ key: 'x', zone: 'ghost' }], { vip: { price: 1700 } }), 0);
});
