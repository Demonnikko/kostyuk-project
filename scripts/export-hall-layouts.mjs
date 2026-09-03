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

import { existsSync } from 'node:fs';
import { fbPut, FB_URL } from '../shared/firebase.js';

const SHOWS = {
  secret: '/concerts/secret/',
  huligan: '/concerts/huligan/',
  matvey: '/concerts/matvey/',
};

function parseArgs(argv) {
  const args = { dryRun: false, base: 'http://localhost:8899', show: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--base=')) args.base = a.slice('--base='.length);
    else if (a.startsWith('--show=')) args.show = a.slice('--show='.length);
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
