import { fbGet, fbPatch, fbPut } from '../../shared/firebase.js';
import { setCors } from '../../shared/cors.js';

// Разрешённые шаги воронки (в порядке прохождения).
const STEPS = ['visit', 'seats', 'contacts', 'payment', 'paid'];
const STEP_INDEX = STEPS.reduce((m, s, i) => { m[s] = i; return m; }, {});
const SHOWS = ['secret', 'huligan', 'matvey'];
const AUDIENCE_AREAS = ['hub', 'shows', 'secret', 'huligan', 'matvey', 'events', 'school'];
const AUDIENCE_DEVICES = ['iphone', 'ipad', 'android', 'desktop', 'other'];
const AUDIENCE_BROWSERS = ['safari', 'chrome', 'yandex', 'firefox', 'edge', 'samsung', 'other'];

function todayKey() {
  // YYYY-MM-DD по МСК (UTC+3), чтобы «сегодня» совпадало с часовым поясом заказчика.
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function sanitizeId(v) {
  return /^[A-Za-z0-9_-]{6,64}$/.test(String(v || '')) ? String(v) : null;
}
function sanitizeSource(v) {
  // Источник: короткая строка (utm/поддомен/direct). Чистим от мусора.
  return String(v || 'direct').trim().slice(0, 60).replace(/[^\wа-яА-Я.\-:/? =&]/g, '') || 'direct';
}
function sanitizePromo(v) {
  const code = String(v || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function classifyDevice(userAgent) {
  const ua = String(userAgent || '');
  if (/iPad/i.test(ua)) return 'ipad';
  if (/iPhone|iPod/i.test(ua)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

function classifyBrowser(userAgent) {
  const ua = String(userAgent || '');
  if (/YaBrowser|Yowser/i.test(ua)) return 'yandex';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Chrome|CriOS/i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua)) return 'safari';
  return 'other';
}

// Атомарный-ish инкремент счётчика (read-modify-write). Для нашей нагрузки достаточно.
async function bump(path) {
  const cur = Number(await fbGet(path)) || 0;
  await fbPut(path, cur + 1);
}

export default async function handler(req, res) {
  setCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const sessionId = sanitizeId(body.sessionId);
  if (body.kind === 'audience') {
    const area = AUDIENCE_AREAS.includes(body.area) ? body.area : null;
    if (!area || !sessionId) return res.status(400).json({ error: 'area, sessionId required' });
    const day = todayKey();
    const now = Date.now();
    const userAgent = req.headers?.['user-agent'] || '';
    const device = AUDIENCE_DEVICES.includes(body.device) ? body.device : classifyDevice(userAgent);
    const browser = AUDIENCE_BROWSERS.includes(body.browser) ? body.browser : classifyBrowser(userAgent);
    const sessionPath = `analytics/audienceSessions/${day}/${sessionId}`;

    try {
      const session = (await fbGet(sessionPath)) || null;
      if (!session) {
        await bump(`analytics/audience/${day}/total`);
        await bump(`analytics/audience/${day}/devices/${device}`);
        await bump(`analytics/audience/${day}/browsers/${browser}`);
        await fbPatch(sessionPath, { firstAt: now, lastAt: now, device, browser });
      } else {
        await fbPatch(sessionPath, { lastAt: now });
      }
      if (!session?.areas?.[area]) {
        await bump(`analytics/audience/${day}/areas/${area}`);
        await fbPut(`${sessionPath}/areas/${area}`, true);
      }
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(200).json({ ok: false });
    }
  }

  const show = SHOWS.includes(body.show) ? body.show : null;
  const step = STEP_INDEX[body.step] != null ? body.step : null;
  if (!show || !step || !sessionId) {
    return res.status(400).json({ error: 'show, step, sessionId required' });
  }
  const source = sanitizeSource(body.source);
  const promoCode = sanitizePromo(body.promoCode);
  const day = todayKey();
  const now = Date.now();

  try {
    // 1) Счётчик воронки: analytics/funnel/{show}/{day}/{step}
    // Считаем шаг для сессии только ОДИН раз (иначе перезагрузка накрутит).
    const sess = (await fbGet(`analytics/sessions/${sessionId}`)) || null;
    const reached = sess?.maxStep != null ? STEP_INDEX[sess.maxStep] ?? -1 : -1;
    const thisIdx = STEP_INDEX[step];

    if (thisIdx > reached) {
      // засчитываем все НОВЫЕ шаги от reached+1 до thisIdx (на случай пропуска)
      for (let i = reached + 1; i <= thisIdx; i++) {
        await bump(`analytics/funnel/${show}/${day}/${STEPS[i]}`);
      }
    }

    // 2) Сессия: источник (пишем при первом визите), шоу, макс шаг, время.
    const sessPatch = { show, lastStep: step, lastAt: now };
    if (!sess) { sessPatch.source = source; sessPatch.firstAt = now; sessPatch.day = day; }
    if (thisIdx > reached) sessPatch.maxStep = step;
    await fbPatch(`analytics/sessions/${sessionId}`, sessPatch);

    // Один переход по рекламной ссылке на одну сессию. Повторная загрузка не накручивает счётчик.
    if (promoCode && step === 'visit') {
      await fbPut(`analytics/promoClicks/${show}/${promoCode}/${sessionId}`, { firstAt: now, source });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Аналитика не должна ломать покупку — просто молча ок.
    return res.status(200).json({ ok: false });
  }
}
