export default async function handler(req, res) {
  // Разрешаем только POST + CORS под ваш домен GitHub Pages
  const allowedOrigins = [
    'https://demonnikko.github.io',          // ваш GitHub Pages домен
    // 'https://ваш-домен.ру',               // добавите, если подключите свой домен
  ];
  const origin = req.headers.origin || '';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { name = '', phone = '', tg = '', note = '', order = {} } = req.body || {};

    // Простейшие валидации/очистка
    const clean = (s) => String(s || '').toString().slice(0, 500);
    const msg =
      `<b>Новая заявка с сайта</b>\n` +
      `Имя: ${clean(name)}\n` +
      `Тел.: +7${clean(phone)}\n` +
      (tg ? `Telegram: ${clean(tg)}\n` : '') +
      (note ? `Комментарий: ${clean(note)}\n` : '') +
      (order && Object.keys(order).length
        ? `\n<b>Расчёт:</b>\n` +
          `Где: ${clean(order.area || '')}, ${clean(order.city || '')}\n` +
          `Дата: ${clean(order.date || '')}\n` +
          `Гости: ${clean(order.guests || '')}\n` +
          `Услуга: ${clean(order.service || '')}\n` +
          `Цена: ${clean(order.price || '')}\n` +
          `Скидка: ${clean(order.discount || '')}\n`
        : '');

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID; // ваш ID или ID канала/чата

    if (!token || !chatId) {
      return res.status(500).json({ ok: false, error: 'Server is not configured' });
    }

    // Отправка в Telegram
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const data = await tgRes.json();
    if (!data.ok) {
      return res.status(502).json({ ok: false, error: 'Telegram error', details: data });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}