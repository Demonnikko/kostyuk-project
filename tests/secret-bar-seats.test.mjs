import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Secret exposes three sequential orange bar seats on every surface', async () => {
  const [page, admin, seatsApi, bookApi, layoutRaw] = await Promise.all([
    read('concerts/secret/index.html'),
    read('admin/index.html'),
    read('api/_endpoints/seats.js'),
    read('api/_endpoints/book.js'),
    read('vk-mini-app-dist/data/layout-secret.json')
  ]);
  const layout = JSON.parse(layoutRaw).layout;

  assert.match(page, /bar:\s*\{[^}]*color:\s*'#f0913d'[^}]*price:\s*800/);
  for (const [key, number] of [['bar_1', 107], ['bar_2', 108], ['bar_3', 109]]) {
    assert.match(page, new RegExp(`key: '${key}'[^}]*seatNum: ${number}`));
    assert.ok(admin.includes(`['${key}'], ${number}`));
    assert.ok(seatsApi.includes(`'${key}'`));
    assert.ok(bookApi.includes(`'${key}'`));
    const vkSeat = layout.seats.find((seat) => seat.key === key);
    assert.ok(vkSeat, `VK layout misses ${key}`);
    assert.equal(vkSeat.seatNum, number);
    assert.equal(vkSeat.zone, 'bar');
  }
  assert.equal(layout.seatCount, 110);
  assert.equal(layout.zones.bar.color, '#f0913d');
  assert.match(bookApi, /VALID_ZONES[^\n]*'bar'/);
  assert.match(bookApi, /bar:\s*800/);
  assert.match(bookApi, /formatSecretSeat/);
  assert.doesNotMatch(bookApi, /Number\(s\.seatIdx\) \+ 1/);
});
