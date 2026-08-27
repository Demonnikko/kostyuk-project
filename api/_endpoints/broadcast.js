/**
 * POST /api/broadcast
 * Массовая рассылка в VK и/или Telegram.
 * Доступ только администратору (x-admin-pass / x-admin-pass-b64).
 */
import crypto from 'crypto';
import {  isAdminAuthorized  } from '../../shared/adminAuth.js';
import {  setCors  } from '../../shared/cors.js';

const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const VK_TOKEN = (process.env.VK_TOKEN || '').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    return await r.json();
  } catch {
    return null;
  }
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function vkSend(userId, text) {
  if (!VK_TOKEN || !userId) return { ok: false };
  try {
    const params = new URLSearchParams({
      peer_id: String(userId),
      message: text,
      random_id: crypto.randomInt(1, 2_000_000_000),
      access_token: VK_TOKEN,
      v: '5.199'
    });
    const r = await fetch('https://api.vk.com/method/messages.send', { method: 'POST', body: params });
    const d = await r.json();
    return { ok: !d?.error };
  } catch {
    return { ok: false };
  }
}

async function tgSend(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: String(text),
        disable_web_page_preview: true
      })
    });
    const d = await r.json();
    return { ok: !!d?.ok };
  } catch {
    return { ok: false };
  }
}

async function collectRecipients() {
  const [botUsers, ticketUsers, ticketBookings, huliganBookings] = await Promise.all([
    fbGet('bot_users'),
    fbGet('ticket_users'),
    fbGet('ticket_bookings'),
    fbGet('huligan_bookings')
  ]);

  const vkSet = new Set();
  const tgSet = new Set();

  Object.keys(botUsers || {}).forEach((id) => {
    const vk = toInt(id);
    if (vk > 0) vkSet.add(vk);
  });

  Object.values(ticketUsers || {}).forEach((u) => {
    const vk = toInt(u?.vkId);
    const tg = toInt(u?.tgUserId);
    if (vk > 0) vkSet.add(vk);
    if (tg > 0) tgSet.add(tg);
  });

  Object.values(ticketBookings || {}).forEach((b) => {
    const vk = toInt(b?.vkUserId);
    const tg = toInt(b?.tgUserId);
    if (vk > 0) vkSet.add(vk);
    if (tg > 0) tgSet.add(tg);
  });

  Object.values(huliganBookings || {}).forEach((b) => {
    const vk = toInt(b?.vkUserId);
    const tg = toInt(b?.tgUserId);
    if (vk > 0) vkSet.add(vk);
    if (tg > 0) tgSet.add(tg);
  });

  return {
    vk: [...vkSet],
    tg: [...tgSet]
  };
}

export default async (req, res) => {
  setCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Боты Telegram/VK убраны — массовая рассылка отключена. Эндпоинт сохранён,
  // чтобы старые вызовы не падали, но ничего не отправляет.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  if (!(await isAdminAuthorized(req, body))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return res.status(200).json({ ok: false, disabled: true, error: 'Рассылки через ботов отключены' });
};
