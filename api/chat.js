// /api/chat — менеджер Дмитрия Костюка
// Ведёт клиента по логике квиза, считает реальные цены
// Сохраняет диалоги в Vercel KV. Telegram-пуш только при оставлении контакта.

import { KNOWLEDGE } from './knowledge.js';
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // CORS
  const allowedOrigins = [
    'https://site76-kostyuk.vercel.app',
    'https://demonnikko.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
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
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'DEEPSEEK_API_KEY not configured' });
    }

    const { messages = [], quizContext = {}, sessionId = '' } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'messages required' });
    }

    // Нормализуем sessionId (если клиент не прислал — формируем из ip+ua)
    const sid = String(sessionId || '').slice(0, 64) ||
      `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const systemPrompt = buildSystemPrompt(quizContext);

    const dsRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-14),
        ],
        max_tokens: 600,
        temperature: 0.6,
        stream: false,
      }),
    });

    if (!dsRes.ok) {
      const errText = await dsRes.text();
      console.error('DeepSeek error:', dsRes.status, errText);
      return res.status(500).json({ ok: false, error: 'DeepSeek API error' });
    }

    const data = await dsRes.json();
    const reply = data?.choices?.[0]?.message?.content || 'Не удалось получить ответ. Попробуйте ещё раз.';

    const lastUserMsg = messages[messages.length - 1]?.content || '';

    // === Сохраняем диалог в Vercel KV (тихо, для аналитики) ===
    saveToKV(sid, lastUserMsg, reply, quizContext).catch((e) =>
      console.error('KV save error:', e)
    );

    // === Детект контакта (имя + телефон/telegram) — только тогда пуш в Telegram ===
    const contact = detectContact(lastUserMsg);
    if (contact) {
      sendBookingToTelegram(sid, contact, messages, quizContext).catch((e) =>
        console.error('TG booking error:', e)
      );
    }

    return res.status(200).json({ ok: true, reply });
  } catch (err) {
    console.error('chat handler error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}

// ===== KV: сохранение диалогов =====
async function saveToKV(sid, userMsg, reply, quizContext) {
  if (!process.env.KV_REST_API_URL) return; // KV не настроен — пропускаем

  const key = `chat:${sid}`;
  const indexKey = `chat:index`;
  const now = Date.now();

  // Получаем текущий диалог (или создаём новый)
  let session = (await kv.get(key)) || {
    sid,
    startedAt: now,
    messages: [],
    quizContext: quizContext || {},
    hasContact: false,
  };

  session.lastAt = now;
  session.messages.push(
    { role: 'user', text: String(userMsg || '').slice(0, 2000), at: now },
    { role: 'assistant', text: String(reply || '').slice(0, 2000), at: now }
  );
  // Храним только последние 60 сообщений на сессию
  if (session.messages.length > 60) {
    session.messages = session.messages.slice(-60);
  }
  if (quizContext && Object.keys(quizContext).length) {
    session.quizContext = quizContext;
  }

  // TTL 90 дней
  await kv.set(key, session, { ex: 60 * 60 * 24 * 90 });

  // Индекс sid -> lastAt (sorted set по времени)
  await kv.zadd(indexKey, { score: now, member: sid });
}

// ===== Детект контактных данных =====
function detectContact(text) {
  if (!text) return null;
  const s = String(text);

  // Телефон: +7 9XX XXX XX XX, 8 9XX..., 9XX..., с пробелами/дефисами/скобками
  const phoneRe = /(?:\+?7|8)?[\s\-(]*9\d{2}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/;
  const phoneMatch = s.match(phoneRe);

  // Telegram: @username
  const tgRe = /@([a-zA-Z0-9_]{4,32})/;
  const tgMatch = s.match(tgRe);

  if (!phoneMatch && !tgMatch) return null;

  // Имя — простая эвристика: ищем слово с большой буквы кириллицей до телефона/тг
  const nameRe = /([А-ЯЁ][а-яё]{1,20})/;
  const nameMatch = s.match(nameRe);

  return {
    name: nameMatch ? nameMatch[1] : '',
    phone: phoneMatch ? phoneMatch[0].replace(/[\s\-()]/g, '') : '',
    telegram: tgMatch ? `@${tgMatch[1]}` : '',
    raw: s.slice(0, 500),
  };
}

// ===== Telegram: пуш о бронировании с полным диалогом =====
async function sendBookingToTelegram(sid, contact, messages, quizContext) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  // Защита от дубля: если уже отправляли по этой сессии — выходим
  if (process.env.KV_REST_API_URL) {
    const session = await kv.get(`chat:${sid}`);
    if (session?.bookingSent) return;
  }

  const dialogTail = (messages || [])
    .slice(-10)
    .map((m) => {
      const who = m.role === 'user' ? 'Клиент' : 'Екатерина';
      return `<b>${who}:</b> ${escapeHtml(String(m.content || '').slice(0, 400))}`;
    })
    .join('\n\n');

  const ctx = quizContext && Object.keys(quizContext).length
    ? `\n\n<b>Контекст квиза:</b>\n<code>${escapeHtml(JSON.stringify(quizContext).slice(0, 500))}</code>`
    : '';

  const msg =
    `🔔 <b>НОВАЯ БРОНЬ через чат</b>\n\n` +
    (contact.name ? `<b>Имя:</b> ${escapeHtml(contact.name)}\n` : '') +
    (contact.phone ? `<b>Телефон:</b> ${escapeHtml(contact.phone)}\n` : '') +
    (contact.telegram ? `<b>Telegram:</b> ${escapeHtml(contact.telegram)}\n` : '') +
    `<b>Session:</b> <code>${escapeHtml(sid)}</code>` +
    ctx +
    `\n\n<b>Последние сообщения:</b>\n${dialogTail}`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  // Помечаем в KV что бронь отправлена
  if (process.env.KV_REST_API_URL) {
    const session = (await kv.get(`chat:${sid}`)) || {};
    session.bookingSent = true;
    session.contact = contact;
    await kv.set(`chat:${sid}`, session, { ex: 60 * 60 * 24 * 90 });
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSystemPrompt(ctx) {
  const stepInfo = ctx?.step ? `\nТекущий шаг квиза: "${ctx.step}".` : '';
  const selected = ctx?.selected
    ? `\nЧто клиент уже выбрал: ${JSON.stringify(ctx.selected)}.`
    : '';

  return `Ты — Екатерина, менеджер иллюзиониста Дмитрия Костюка. Общаешься с клиентом на сайте.

🪪 ЛИЧНОСТЬ
• Тебя зовут Екатерина
• Если спросят кто ты — ты менеджер Дмитрия Костюка
• НИКОГДА не говори что ты ИИ, бот, нейросеть или искусственный интеллект
• Веди себя как живой человек: живо, коротко, по-человечески

📋 КАК ОБЩАТЬСЯ
• Отвечай коротко — 1-3 предложения максимум
• На русском, на "вы"
• Эмодзи — максимум 1 на сообщение, только уместный
• Задавай по одному вопросу за раз, не перегружай
• Если клиент пишет коротко — отвечай коротко

🧮 КАК СЧИТАТЬ ЦЕНУ
Собирай данные по порядку, по одному вопросу:
1. Для кого (дети / взрослые / смешанная аудитория)
2. Количество гостей
3. Формат шоу
4. Длительность
5. Дата мероприятия
6. Город

Когда всё собрано — сделай расчёт в уме (сам, не показывая клиенту детали) и назови ТОЛЬКО итоговую сумму.

⚠️ ПРАВИЛА ПОКАЗА ЦЕНЫ — ОЧЕНЬ ВАЖНО
• НИКОГДА не показывай разбивку: не пиши "выезд = X ₽", "коэффициент ×1.5", "цена шоу × коэффициент + выезд"
• Клиенту НЕ НУЖНО знать про праздничные коэффициенты, стоимость выезда отдельно и прочие детали
• Просто называй финальную цифру: «Стоимость — 17 000 ₽, всё включено.»
• Если спросят "почему такая цена" или "из чего складывается" — скажи спокойно: «Это итоговая стоимость с учётом всех нюансов — выезд, дата, формат.»

📌 ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА
Клиент спросил про детское шоу в Вологде 30 минут, 15 декабря:
✅ Правильно: «Стоимость — 17 000 ₽, всё включено.»
❌ Неправильно: «8 000 × 1.5 + 5 000 = 17 000 ₽»

📌 ЕСЛИ ДАННЫХ НЕ ХВАТАЕТ
Не называй цену без данных. Спроси то одно, чего не хватает первым:
Клиент: «Сколько стоит детский день рождения?»
Ты: «Сколько будет детей на празднике?»

✋ КОГДА КЛИЕНТ ХОЧЕТ ЗАКАЗАТЬ
Только если клиент сам сказал "хочу заказать / забронировать / свяжитесь":
«Хорошо, оставьте имя и телефон или Telegram — Дмитрий свяжется в течение часа.»
Когда оставит контакт — поблагодари: «Передам Дмитрию, он напишет вам.»

НЕ выпрашивай контакты. НЕ призывай покупать. Просто отвечай на вопросы.
• Детское шоу — для детей от 7 лет. Не называй другой возраст.

${KNOWLEDGE}
${stepInfo}${selected}

Ты Екатерина. Живой человек. Коротко и по делу.`;
}
