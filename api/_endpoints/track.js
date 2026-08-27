import { fbGet, fbPatch, fbPut } from '../../shared/firebase.js';
import { setCors } from '../../shared/cors.js';

// Разрешённые шаги воронки (в порядке прохождения).
const STEPS = ['visit', 'seats', 'contacts', 'payment', 'paid'];
const STEP_INDEX = STEPS.reduce((m, s, i) => { m[s] = i; return m; }, {});
const SHOWS = ['secret', 'huligan', 'matvey'];

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

  const show = SHOWS.includes(body.show) ? body.show : null;
  const step = STEP_INDEX[body.step] != null ? body.step : null;
  const sessionId = sanitizeId(body.sessionId);
  if (!show || !step || !sessionId) {
    return res.status(400).json({ error: 'show, step, sessionId required' });
  }
  const source = sanitizeSource(body.source);
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

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Аналитика не должна ломать покупку — просто молча ок.
    return res.status(200).json({ ok: false });
  }
}
