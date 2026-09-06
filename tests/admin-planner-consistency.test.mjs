import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('planner uses every sellable zone and exact website capacity', async () => {
  const html = await read('admin/index.html');
  assert.match(html, /huligan:\s*\{[\s\S]*?capacity:\s*72\b/);
  assert.match(html, /secret:\s*\{[\s\S]*?capacity:\s*110\b/);
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
    "drawSeat(1000, 642, 'bar', ['bar_1'], 107",
    "drawSeat(1060, 642, 'bar', ['bar_2'], 108",
    "drawSeat(1120, 642, 'bar', ['bar_3'], 109",
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
  assert.match(api, /promoCode:\s*promoApplied/);
  assert.match(api, /discountedTotal\s*=\s*Math\.round\(total\s*\*\s*\(1\s*-\s*value\s*\/\s*100\)\)/);
});

test('planner combines per-show expenses, actual sales, and promo buyer attribution', async () => {
  const html = await read('admin/index.html');
  assert.match(html, /id="plannerFinanceHost"/);
  assert.match(html, /function mountPlannerFinances\(/);
  assert.match(html, /_plExpensesSum/);
  assert.match(html, /promoBuyers/);
  assert.match(html, /ticketNumber/);
  assert.match(html, /plLoadReal\(true\)/);
  assert.match(html, /Планировщик и финансы/);
  assert.match(html, /loadPlannerWorkspace\(/);
  assert.doesNotMatch(html, /data-sec="finances"/);
});

test('advertising promo links track unique visits and remain visible in admin', async () => {
  const [admin, tracker, api] = await Promise.all([
    read('admin/index.html'),
    read('concerts/track.js'),
    read('api/_endpoints/track.js')
  ]);
  assert.match(admin, /id="adCreatedNotice"/);
  assert.match(admin, /function adPromoLink\(/);
  assert.match(admin, /Копировать ссылку/);
  assert.match(admin, /Переходы/);
  assert.match(admin, /promoClicks/);
  assert.match(tracker, /promoCode/);
  assert.match(tracker, /promoCodeInput/);
  assert.match(api, /analytics\/promoClicks/);
});

test('deleting an advertising promo removes its promo, click stats, and linked expense', async () => {
  const [admin, proxy] = await Promise.all([
    read('admin/index.html'),
    read('api/_endpoints/admin-proxy.js')
  ]);
  assert.match(admin, /function deletePromoFully\(/);
  assert.match(admin, /async function fbDelete\(path\)[\s\S]*?if \(!response\.ok/);
  assert.match(admin, /analytics\/promoClicks\/\$\{show\}\/\$\{code\}/);
  assert.match(admin, /finances\/expenses\/ad_\$\{show\}_\$\{code\}/);
  assert.match(admin, /Удалить промокод .* всю его статистику/);
  assert.match(proxy, /if \(!targetRes\.ok\)/);
});

test('expenses and promos confirm persistence and shows use requested order', async () => {
  const admin = await read('admin/index.html');
  assert.match(admin, /if \(!response\.ok\)/);
  assert.match(admin, /const saved = await fbGet\(path\)/);
  assert.match(admin, /const savedPromo = await fbGet\(promoPath\)/);
  assert.match(admin, /\['huligan', 'secret', 'matvey'\]\.map/);
  assert.ok(admin.indexOf('value="huligan">😈 ХУЛИgan') < admin.indexOf('value="secret">🎭 Секрет'));
});

test('browser and PWA admin expose the same visible release version', async () => {
  const [admin, serviceWorker] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-sw.js')
  ]);
  assert.match(admin, /id="adminVersionLabel"[\s\S]*?Версия админки v23/);
  assert.match(serviceWorker, /const VERSION = 'kp-admin-v23'/);
});
