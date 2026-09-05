#!/usr/bin/env node
// Экспортирует канонические схемы залов из РЕАЛЬНОГО кода страниц продажи в Firebase.
// Единый источник (вариант 1): сайт продолжает генерировать схему сам, а Mini App
// читает КОПИЮ из базы. Скрипт запускает каждую страницу в headless Chrome, берёт
// SEATS + ZONES (ровно то, что рисует сайт) и кладёт в {show}_hall_layout.
//
// Запись в PRODUCTION Firebase выполняется под контролем владельца — нужен
// FIREBASE_DB_URL + FIREBASE_SECRET в окружении. Используйте --dry-run для проверки
// без записи.
//
// Использование:
//   node scripts/export-hall-layouts.mjs --dry-run          # только показать, не писать
//   node scripts/export-hall-layouts.mjs --base=http://localhost:8899 --dry-run
//   node scripts/export-hall-layouts.mjs                     # записать в Firebase (нужны env)
//   node scripts/export-hall-layouts.mjs --show=huligan      # только одно шоу
//
// ПЕРЕД записью: локальный статик-сервер должен отдавать страницы (python3 -m http.server 8899).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Подгружаем локальные секреты (.env.local и т.п.) в process.env ДО импорта firebase.js,
// как это делает server.js. Значения из шелла имеют приоритет. Секреты не логируются.
(function loadLocalEnv() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(dir, '..');
  const shellKeys = new Set(Object.keys(process.env));
  for (const fileName of ['.env', '.env.local', '.env.vercel.local']) {
    const full = path.join(root, fileName);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const clean = t.startsWith('export ') ? t.slice(7).trim() : t;
      const eq = clean.indexOf('=');
      if (eq <= 0) continue;
      const key = clean.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || shellKeys.has(key)) continue;
      let val = clean.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      val = val.replace(/\\n/g, '').trim();
      // Первое непустое значение побеждает: не даём более позднему файлу
      // (напр. .env.vercel.local с FIREBASE_DB_URL="") затереть рабочее значение.
      if (val === '' && process.env[key]) continue;
      if (process.env[key] && process.env[key] !== '') continue;
      process.env[key] = val;
    }
  }
})();

const { fbPut, FB_URL } = await import('../shared/firebase.js');

const SHOWS = {
  secret: '/concerts/secret/',
  huligan: '/concerts/huligan/',
  matvey: '/concerts/matvey/',
};

function parseArgs(argv) {
  const args = { dryRun: false, base: 'http://localhost:8899', show: null, writeDist: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--base=')) args.base = a.slice('--base='.length);
    else if (a.startsWith('--show=')) args.show = a.slice('--show='.length);
    else if (a === '--write-dist') args.writeDist = true;
  }
  return args;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find(existsSync);
}

// Забирает канонический каталог из исполнённого кода страницы.
async function extractLayout(page) {
  return page.evaluate(() => {
    if (typeof SEATS === 'undefined') throw new Error('SEATS is not defined on the page');
    const svg = document.getElementById('hallSvg');
    const viewBox = svg ? svg.getAttribute('viewBox') : null;
    const seats = SEATS
      .filter((s) => s && s.zone)
      .map((s) => ({
        key: s.key,
        zone: s.zone,
        seatNum: s.seatNum != null ? s.seatNum : null,
        table: s.table != null ? s.table : null,
        x: s.x != null ? Math.round(s.x * 10) / 10 : null,
        y: s.y != null ? Math.round(s.y * 10) / 10 : null,
        type: s.type || null,
        label: s.label || null,
      }));
    const zones = typeof ZONES !== 'undefined' ? ZONES : null;
    return { viewBox, seats, zones };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const showIds = args.show ? [args.show] : Object.keys(SHOWS);
  for (const id of showIds) {
    if (!SHOWS[id]) throw new Error(`Unknown show: ${id}`);
  }

  const executablePath = findChrome();
  if (!executablePath) {
    console.error('Chrome not found. Set CHROME_PATH to a Chrome/Chromium binary.');
    process.exit(2);
  }
  if (!args.dryRun && !FB_URL) {
    console.error('FIREBASE_DB_URL is not set. Refusing to write. Use --dry-run or set env.');
    process.exit(2);
  }

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
  try {
    for (const id of showIds) {
      const url = `${args.base}${SHOWS[id]}`;
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      // SEATS строится синхронно при загрузке скрипта страницы.
      const layout = await extractLayout(page);
      await page.close();

      const payload = {
        show: id,
        viewBox: layout.viewBox,
        seats: layout.seats,
        zones: layout.zones,
        seatCount: layout.seats.length,
        exportedAt: Date.now(),
        exportedFrom: url,
      };

      console.log(`[${id}] ${payload.seatCount} seats, viewBox ${payload.viewBox}, zones ${layout.zones ? Object.keys(layout.zones).length : 0}`);

      if (args.writeDist) {
        const distPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vk-mini-app-dist', 'data', `layout-${id}.json`);
        writeFileSync(distPath, JSON.stringify({ ok: true, show: id, layout: payload }));
        console.log(`[${id}] written to ${path.relative(process.cwd(), distPath)}`);
      }

      if (args.dryRun) {
        console.log(`[${id}] dry-run: not writing. Sample seat:`, JSON.stringify(payload.seats[0]));
      } else {
        await fbPut(`${id}_hall_layout`, payload);
        console.log(`[${id}] written to ${id}_hall_layout`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(args.dryRun ? 'Dry run complete (no writes).' : 'Export complete.');
}

main().catch((err) => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
