import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('daily audience series is chronological and keeps zero-visit days', async () => {
  const moduleUrl = new URL('../admin/analytics-trend.js', import.meta.url);
  assert.ok(existsSync(moduleUrl), 'admin/analytics-trend.js must provide the chart data model');
  const { buildAudienceTrendSeries } = await import(moduleUrl);
  const raw = {
    '2026-09-04': { total: 8 },
    '2026-09-06': { total: 13 },
  };
  assert.deepEqual(
    buildAudienceTrendSeries(raw, ['2026-09-06', '2026-09-05', '2026-09-04']),
    [
      { day: '2026-09-04', value: 8 },
      { day: '2026-09-05', value: 0 },
      { day: '2026-09-06', value: 13 },
    ],
  );
});

test('admin renders a 7 or 30 day visits curve from audience totals', async () => {
  const [admin, serviceWorker] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-sw.js'),
  ]);
  assert.match(admin, /id="audienceTrendContent"/);
  assert.match(admin, /value="7" selected>7 дней/);
  assert.match(admin, /value="30">30 дней/);
  assert.match(admin, /AdminAnalyticsTrend\.buildAudienceTrendSeries/);
  assert.match(admin, /AdminAnalyticsTrend\.renderAudienceTrend/);
  assert.match(admin, /Версия админки v26/);
  assert.match(serviceWorker, /const VERSION = 'kp-admin-v26'/);
});

test('ecosystem page views populate daily totals and all public areas', async () => {
  const [ecosystem, endpoint] = await Promise.all([
    read('ecosystem.js'),
    read('api/_endpoints/track.js'),
  ]);
  for (const area of ['hub', 'shows', 'secret', 'huligan', 'matvey', 'events', 'school']) {
    assert.match(ecosystem, new RegExp(`['"]${area}['"]`), `missing ecosystem area ${area}`);
  }
  assert.match(ecosystem, /fetch\(['"]\/api\/track['"]/);
  assert.match(ecosystem, /kind:\s*['"]audience['"]/);
  assert.match(endpoint, /analytics\/audience\/\$\{day\}\/total/);
  assert.match(endpoint, /analytics\/audience\/\$\{day\}\/areas\/\$\{area\}/);
  assert.match(endpoint, /analytics\/audienceSessions\/\$\{day\}\/\$\{sessionId\}/);
});
