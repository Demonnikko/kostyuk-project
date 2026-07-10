// /api/lead-concert — заявка на бронь билета на концертное шоу
// Принимает данные брони и шлёт в Telegram

import { fbGet, fbPut } from '../../shared/firebase.js';

function formatSeatLine(s, escape) {
  if (s.label) {
    return `${escape(s.label)}` + (s.price ? ` — ${escape(String(s.price))} ₽` : '');
  }
  return `${escape(s.zone || '')} · ${escape(String(s.table || s.seatNum ? 'место ' + s.seatNum : '?'))}` +
    (s.price ? ` — ${escape(String(s.price))} ₽` : '');
}

async function lockMatveySeats(seats, bookingId) {
  const keys = seats.map(s => String(s.key || '').trim()).filter(Boolean);
  if (!keys.length) return null;

  const conflicts = [];
  for (const key of keys) {
    const cur = await fbGet(`matvey_seats/${key}`);
    const st = String(cur?.status || '');
    if (st === 'taken' || st === 'pending' || st === 'reserved') conflicts.push(key);
  }
  if (conflicts.length) return { error: 'Seats unavailable', seats: conflicts };

  const now = Date.now();
  await Promise.all(keys.map(key =>
    fbPut(`matvey_seats/${key}`, { status: 'pending', bookingId, at: now })
  ));
  return { ok: true };
}

export default async function handler(req, res) {
  const allowedOrigins = [
    'https://kostyuk-project.vercel.app',
    'https://site76-kostyuk.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8765',
  ];
  const origin = req.headers.origin || '';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const {
      show = '',           // 'secret' | 'huligan' | 'matvey'
      eventDate = '',      // строка с датой выбранной
      seats = [],          // массив выбранных мест [{table, zone, seatNum, price}]
      ticketCount = 1,     // для шоу без рассадки
      ticketType = '',     // для общего входа
      name = '',
      phone = '',
      telegram = '',
      comment = '',
      source = 'web',      // 'web' | 'vk' | 'tg'
    } = req.body || {};

    const clean = (s, max = 300) => String(s || '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
    const showName = ({ secret: 'СЕКРЕТ', huligan: 'ХУЛИgan', matvey: 'СПАСТИ МАТВЕЯ' })[show] || clean(show);

    const cleanName = clean(name, 60);
    const cleanPhone = clean(phone, 30);
    const cleanTg = clean(telegram, 60);
    const cleanDate = clean(eventDate, 40);
    const cleanComment = clean(comment, 400);

    if (!cleanName || (!cleanPhone && !cleanTg)) {
      return res.status(400).json({ ok: false, error: 'name and phone/telegram required' });
    }

    const bookingId = `LEAD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    if (show === 'matvey' && Array.isArray(seats) && seats.length > 0) {
      const lock = await lockMatveySeats(seats, bookingId);
      if (lock?.error) {
        return res.status(409).json({ ok: false, error: lock.error, seats: lock.seats });
      }
      await fbPut(`matvey_bookings/${bookingId}`, {
        show: 'matvey',
        status: 'pending',
        name: cleanName,
        phone: cleanPhone,
        telegram: cleanTg,
        eventDate: cleanDate,
        comment: cleanComment,
        seats,
        source,
        createdAt: Date.now()
      }).catch(() => {});
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return res.status(500).json({ ok: false, error: 'Telegram is not configured' });
    }

    const escape = (s) =>
      String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let seatsBlock = '';
    if (Array.isArray(seats) && seats.length > 0) {
      seatsBlock = '\n\n🎟 <b>Выбранные места:</b>\n' +
        seats.map((s, i) => `${i + 1}. ${formatSeatLine(s, escape)}`).join('\n');
    } else if (ticketCount > 0 || ticketType) {
      seatsBlock = '\n\n🎟 <b>Билеты:</b>\n';
      if (ticketType) seatsBlock += `Тип: ${escape(ticketType)}\n`;
      if (ticketCount) seatsBlock += `Количество: ${ticketCount}`;
    }

    const sourceLabel = ({ vk: 'ВКонтакте', tg: 'Telegram', web: 'Сайт' })[source] || 'Сайт';

    const msg =
      `🎩 <b>Заявка на концерт «${escape(showName)}»</b>\n\n` +
      `👤 <b>Клиент:</b> ${escape(cleanName)}\n` +
      (cleanPhone ? `📞 <b>Телефон:</b> ${escape(cleanPhone)}\n` : '') +
      (cleanTg ? `✈️ <b>Telegram:</b> ${escape(cleanTg)}\n` : '') +
      (cleanDate ? `📅 <b>Дата:</b> ${escape(cleanDate)}\n` : '') +
      seatsBlock +
      (cleanComment ? `\n\n💬 <b>Комментарий:</b>\n${escape(cleanComment)}` : '') +
      `\n\n📍 <i>Источник: ${sourceLabel}</i>`;

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await tgRes.json();
    if (!data.ok) {
      console.error('Telegram error:', data);
      return res.status(502).json({ ok: false, error: 'Telegram error' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead-concert error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}
