import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('planner uses every sellable zone and exact website capacity', async () => {
  const html = await read('admin/index.html');
  assert.match(html, /huligan:\s*\{[\s\S]*?capacity:\s*72\b/);
  assert.match(html, /secret:\s*\{[\s\S]*?capacity:\s*107\b/);
  assert.match(html, /matvey:\s*\{[\s\S]*?capacity:\s*106\b/);
  for (const zone of ['sofa_left', 'sofa_right', 'divan', 'bar', 'row_front', 'row_back', 'table', 'lampa']) {
    assert.match(html, new RegExp(`key:\\s*['\"]${zone}['\"]`), `planner misses ${zone}`);
  }
});

test('admin hall maps include every website-only seat group', async () => {
  const html = await read('admin/index.html');
  for (const marker of [
    "drawSeat(1155, 350, 'vip', ['lampa']",
    '`t${tbl.id}_${i + 1}`',
    "manageSeatStatus(b.key, 'huligan')",
    "key: 'dl_' + ch.s",
    "key: 'dr_' + ch.s",
    "key: b.key, x: b.x, y: b.y, zone: 'bar'",
    "manageSeatStatus('lampa', 'matvey')"
  ]) assert.ok(html.includes(marker), `admin map misses ${marker}`);
});

test('Matvey checkout validates and stores advertising promo codes', async () => {
  const [page, api] = await Promise.all([
    read('concerts/matvey/index.html'),
    read('api/_endpoints/matvey.js')
  ]);
  assert.match(page, /id="promoCodeInput"/);
  assert.match(page, /promoCode:\s*booking\.promo\s*\?/);
  assert.match(api, /matvey_promo\/\$\{pCode\}/);
  assert.match(api, /promoCode:\s*promoApplied\s*\?/);
  assert.match(api, /discountedTotal\s*=\s*applyPromo/);
});

test('planner combines per-show expenses, actual sales, and promo buyer attribution', async () => {
  const html = await read('admin/index.html');
  assert.match(html, /id="plannerFinanceHost"/);
  assert.match(html, /function mountPlannerFinances\(/);
  assert.match(html, /id="plOther"/);
  assert.match(html, /promoBuyers/);
  assert.match(html, /ticketNumber/);
  assert.match(html, /plLoadReal\(true\)/);
  assert.match(html, /Планировщик и финансы/);
  assert.match(html, /loadPlannerWorkspace\(/);
  assert.doesNotMatch(html, /data-sec="finances"/);
});
