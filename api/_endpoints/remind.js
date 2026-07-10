// Vercel Cron — ежедневно в 07:00 UTC (10:00 МСК)
// Отправляет:
//   • напоминание за 24 часа до шоу всем подтверждённым гостям
//   • запрос на отзыв на следующий день после шоу

import crypto from 'crypto';
const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
const VK_TOKEN = process.env.VK_TOKEN || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
import {  issueTicketLink  } from '../../shared/ticketAccess.js';

// Русские месяцы для парсинга даты из Firebase
const RU_MONTHS = {
  'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
  'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
  'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11
};

function parseRuDate(str) {
  const parts = (str || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  const day = parseInt(parts[0], 10);
  const month = RU_MONTHS[parts[1].toLowerCase()];
  const year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
  if (isNaN(day) || month === undefined || isNaN(year)) return null;
  return new Date(year, month, day);
}

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    return await r.json();
  } catch { return null; }
}

async function fbPut(path, data) {
  try {
    await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch { }
}

async function vkSend(userId, text, keyboard) {
  if (!VK_TOKEN) return null;
  const params = new URLSearchParams({
    peer_id: userId,
    message: text,
    random_id: crypto.randomInt(1, 2_000_000_000),
    access_token: VK_TOKEN,
    v: '5.199'
  });
  if (keyboard) params.set('keyboard', JSON.stringify(keyboard));
  try {
    const r = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST', body: params
    });
    const d = await r.json();
    if (d.error) console.warn('[remind] vkSend error:', JSON.stringify(d.error));
    return d;
  } catch (e) {
    console.error('[remind] vkSend exception:', e.message);
    return null;
  }
}

// Клавиатура для запроса отзыва
function reviewKeyboard() {
  return {
    inline: true,
    buttons: [[
      { action: { type: 'callback', label: '🔥 Огонь!', payload: JSON.stringify({ cmd: 'rate_5' }) }, color: 'positive' },
      { action: { type: 'callback', label: '👍 Нормально', payload: JSON.stringify({ cmd: 'rate_3' }) }, color: 'secondary' },
      { action: { type: 'callback', label: '👎 Не зашло', payload: JSON.stringify({ cmd: 'rate_1' }) }, color: 'negative' }
    ]]
  };
}

export default async (req, res) => {
  // Принимаем GET (Vercel cron) и POST (ручной тест из браузера)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Защита cron:
  // 1) если задан CRON_SECRET — обязателен Authorization: Bearer <CRON_SECRET>
  // 2) если CRON_SECRET не задан — разрешаем только системный Vercel Cron (x-vercel-cron)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else if (!req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const cfg = await fbGet('ticket_config');
    if (!cfg?.show?.date) {
      return res.status(200).json({ ok: true, msg: 'Дата шоу не задана в Firebase' });
    }

    const showDate = parseRuDate(cfg.show.date);
    if (!showDate) {
      return res.status(200).json({ ok: true, msg: `Не удалось разобрать дату: "${cfg.show.date}"` });
    }

    // Сравниваем с сегодня (по МСК: UTC+3)
    const nowUtc = Date.now();
    const mskOffset = 3 * 60 * 60 * 1000;
    const mskNow = new Date(nowUtc + mskOffset);
    const today = new Date(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    const yesterday = new Date(today.getTime() - 86400000);
    const showDay = new Date(showDate.getFullYear(), showDate.getMonth(), showDate.getDate());

    const isTomorrow = showDay.getTime() === tomorrow.getTime();
    const isYesterday = showDay.getTime() === yesterday.getTime();

    if (!isTomorrow && !isYesterday) {
      return res.status(200).json({ ok: true, msg: 'Шоу ни завтра, ни вчера — ничего не отправляем' });
    }

    // Получаем все подтверждённые брони с VK ID
    const allBookings = await fbGet('ticket_bookings') || {};
    const confirmed = Object.entries(allBookings)
      .filter(([, b]) => b.status === 'confirmed' && b.vkUserId)
      .map(([id, b]) => ({ id, ...b }));

    let sent = 0;
    const log = [];

    // ─── Напоминание за 24 часа ───────────────────────────────────────────
    if (isTomorrow) {
      const showTime = cfg.show.time || '18:00';
      const venue = cfg.show.venue || 'Уточняется';
      const showTitle = cfg.show.title || 'Шоу «СЕКРЕТ»';

      for (const b of confirmed) {
        const flagKey = `ticket_reminders/${b.id}_24h`;
        const alreadySent = await fbGet(flagKey);
        if (alreadySent) { log.push(`skip 24h ${b.id}`); continue; }

        const msg =
          `🎭 Напоминание — уже завтра!\n\n` +
          `${showTitle} — ${cfg.show.date} в ${showTime}\n` +
          `📍 ${venue}\n\n` +
          `Ждём вас! Ниже — ваш QR-билет 👇`;

        await vkSend(b.vkUserId, msg);
        const linkRes = await issueTicketLink(b.id);
        const ticketUrl = linkRes.ok
          ? linkRes.url
          : `https://vk-tickets.vercel.app/index.html`;
        await vkSend(b.vkUserId,
          `🎟 Ваш билет:\n${ticketUrl}`
        );

        await fbPut(flagKey, { sentAt: Date.now() });
        sent++;
        log.push(`24h ✓ uid=${b.vkUserId} booking=${b.id}`);
      }
    }

    // ─── Запрос на отзыв (день после шоу) ────────────────────────────────
    if (isYesterday) {
      for (const b of confirmed) {
        const flagKey = `ticket_reminders/${b.id}_review`;
        const alreadySent = await fbGet(flagKey);
        if (alreadySent) { log.push(`skip review ${b.id}`); continue; }

        await vkSend(
          b.vkUserId,
          `✨ Спасибо, что были на шоу!\n\nКак вам понравилось? Один клик — и мы станем лучше 👇`,
          reviewKeyboard()
        );

        await fbPut(flagKey, { sentAt: Date.now() });
        sent++;
        log.push(`review ✓ uid=${b.vkUserId} booking=${b.id}`);
      }
    }

    return res.status(200).json({ ok: true, sent, log });
  } catch (err) {
    console.error('[remind] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
