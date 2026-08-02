import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const defaultPrices = {
  services: {
    'Детское шоу': { '30 минут': 8000, '40 минут': 10000, 'Индивидуальное': 15000 },
    'Стандартная шоу-программа': { '20 минут': 14000, '30 минут': 20000, '40 минут': 26000 },
    'Индивидуальное шоу': { '20 минут': 20000, '30 минут': 28000, '40 минут': 36000 },
    'Взрослое шоу': { '20 минут': 14000, '30 минут': 20000, '40 минут': 26000 },
    'Микромагия': { '30 минут': 10000, '1 час': 16000, '2 часа': 24000, '3 часа': 30000 },
    'Свадьба': { '20 минут': 20000, '30 минут': 27000 },
    'Корпоратив': { '20 минут': 21000, '30 минут': 28000 },
    'Юбилей': { '20 минут': 18000, '30 минут': 28000 },
    'Выпускной': { '20 минут': 17000, '30 минут': 24000 }
  },
  travel: {
    'Ярославская': { 'Ярославль': 1000, 'Гаврилов-Ям': 2000, 'Тутаев': 2000, 'Ростов': 3000, 'Данилов': 3000, 'Рыбинск': 3000, 'Любим': 4000, 'Мышкин': 4000, 'Углич': 4000, 'Переславль': 4000, 'Пошехонье': 5000 },
    'Ивановская': { 'Иваново': 2000, 'Кохма': 2000, 'Тейково': 3000, 'Фурманов': 3000, 'Шуя': 3000, 'Приволжск': 3000, 'Вичуга': 4000, 'Родники': 4000, 'Кинешма': 4000, 'Южа': 5000 },
    'Костромская': { 'Кострома': 3000, 'Волгореченск': 3000, 'Нерехта': 3000, 'Галич': 4000, 'Буй': 5000, 'Мантурово': 5000, 'Шарья': 7000 },
    'Владимирская': { 'Александров': 4000, 'Владимир': 5000, 'Ковров': 5000, 'Гусь-Хрустальный': 6000, 'Муром': 7000 },
    'Вологодская': { 'Вологда': 5000, 'Сокол': 5500, 'Череповец': 7000 },
    'Московская': { 'Москва': 6000, 'Химки': 7000, 'Мытищи': 7000, 'Люберцы': 7000, 'Красногорск': 7000, 'Королёв': 7000, 'Одинцово': 7000, 'Балашиха': 7000, 'Реутов': 7000, 'Подольск': 8000, 'Видное': 8000, 'Пушкино': 8000, 'Щёлково': 8000, 'Домодедово': 8000, 'Зеленоград': 8000, 'Сергиев Посад': 9000, 'Коломна': 9000 }
  },
  holidays: { '12-31': 2, '01-01': 2, '05-09': 1.4, '02-23': 1.3 },
  holidayRanges: [
    { sm: 12, sd: 10, em: 12, ed: 30, k: 1.5 },
    { sm: 1, sd: 2, em: 1, ed: 8, k: 1.3 },
    { sm: 5, sd: 1, em: 5, ed: 3, k: 1.2 },
    { sm: 5, sd: 4, em: 5, ed: 8, k: 1.3 },
    { sm: 3, sd: 6, em: 3, ed: 8, k: 1.3 }
  ],
  deposit: 50,
  metrics: { yandexCounterId: process.env.YANDEX_COUNTER_ID || '107696179' }
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clean(value, max = 700) {
  return String(value || '').trim().slice(0, max);
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: 'telegram_env_missing' };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    return { sent: false, reason: 'telegram_error', details: data };
  }
  return { sent: true };
}

function formatLeadMessage(payload, title = 'Новая заявка с сайта') {
  const order = payload.order || {};
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    payload.source ? `Источник: ${escapeHtml(clean(payload.source))}` : '',
    payload.name ? `Имя: ${escapeHtml(clean(payload.name))}` : '',
    payload.phone ? `Тел.: ${escapeHtml(clean(payload.phone))}` : '',
    payload.tg ? `Telegram: ${escapeHtml(clean(payload.tg))}` : '',
    payload.note ? `Комментарий: ${escapeHtml(clean(payload.note))}` : ''
  ].filter(Boolean);

  if (order && Object.keys(order).length) {
    lines.push(
      '',
      '<b>Расчёт / событие:</b>',
      order.area || order.city ? `Где: ${escapeHtml(clean(order.area))}, ${escapeHtml(clean(order.city))}` : '',
      order.date ? `Дата: ${escapeHtml(clean(order.date))}` : '',
      order.guests ? `Гости: ${escapeHtml(clean(order.guests))}` : '',
      order.audience ? `Аудитория: ${escapeHtml(clean(order.audience))}` : '',
      order.service ? `Услуга: ${escapeHtml(clean(order.service))}` : '',
      order.duration ? `Длительность: ${escapeHtml(clean(order.duration))}` : '',
      order.price ? `Цена: ${escapeHtml(clean(order.price))}` : '',
      order.discount ? `Скидка: ${escapeHtml(clean(order.discount))}` : '',
      order.deposit ? `Предоплата: ${escapeHtml(clean(order.deposit))}` : '',
      order.wishes ? `Пожелания: ${escapeHtml(clean(order.wishes))}` : ''
    );
  }

  if (payload.viewer) {
    lines.push('', `<b>Посетитель:</b> <code>${escapeHtml(JSON.stringify(payload.viewer).slice(0, 900))}</code>`);
  }

  return lines.filter(Boolean).join('\n');
}

function fallbackChatReply(messages) {
  const last = clean(messages?.at(-1)?.content || '', 500).toLowerCase();
  if (last.includes('цена') || last.includes('стоим') || last.includes('сколько')) {
    return 'Стоимость зависит от даты, города, формата и количества гостей. Нажмите «Рассчитать выступление» — сайт задаст несколько вопросов и покажет ориентир.';
  }
  if (last.includes('контакт') || last.includes('телефон') || last.includes('связ')) {
    return 'Оставьте телефон или напишите в VK — я передам заявку Дмитрию и помогу подобрать формат.';
  }
  return 'Я на связи. Расскажите, пожалуйста, для какого события хотите пригласить Дмитрия: свадьба, юбилей, корпоратив, детский праздник или другой формат?';
}

async function handleChat(req, res) {
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
  if (!messages.length) return sendJson(res, 400, { ok: false, error: 'messages required' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return sendJson(res, 200, { ok: true, reply: fallbackChatReply(messages), degraded: true });
  }

  const systemPrompt = [
    'Ты — Екатерина, менеджер иллюзиониста Дмитрия Костюка.',
    'Отвечай на русском, коротко, живо и по делу.',
    'Не говори, что ты ИИ или бот.',
    'Веди к заявке: дата, город, формат, количество гостей, контакт.',
    body.quizContext ? `Контекст квиза: ${JSON.stringify(body.quizContext).slice(0, 1200)}` : ''
  ].filter(Boolean).join('\n');

  const upstream = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 600,
      temperature: 0.6,
      stream: false
    })
  });

  if (!upstream.ok) {
    return sendJson(res, 200, { ok: true, reply: fallbackChatReply(messages), degraded: true });
  }

  const data = await upstream.json();
  const reply = data?.choices?.[0]?.message?.content || fallbackChatReply(messages);
  return sendJson(res, 200, { ok: true, reply });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');

  if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
  if (pathname === '/api/prices' && req.method === 'GET') return sendJson(res, 200, defaultPrices);
  if (pathname === '/api/admin-chats' && req.method === 'GET') return sendJson(res, 200, { ok: true, sessions: [] });

  if (pathname === '/api/lead' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await sendTelegram(formatLeadMessage(body, 'Новая заявка / расчёт частного выступления'));
    return sendJson(res, 200, { ok: true, telegram: result });
  }

  if (pathname === '/api/lead-concert' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await sendTelegram(formatLeadMessage(body, 'Новая заявка по авторскому шоу'));
    return sendJson(res, 200, { ok: true, telegram: result });
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    return handleChat(req, res);
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

function resolveStaticPath(urlPathname) {
  let pathname = decodeURIComponent(urlPathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const candidate = path.normalize(path.join(rootDir, pathname));
  if (!candidate.startsWith(rootDir)) return null;
  return candidate;
}

async function serveStatic(req, res, url) {
  let filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fileStat = await stat(filePath);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  };

  const range = req.headers.range;
  if (range && (ext === '.mp4' || ext === '.mov')) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : fileStat.size - 1;
      if (start <= end && end < fileStat.size) {
        res.writeHead(206, {
          ...headers,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
          'Content-Length': end - start + 1
        });
        return createReadStream(filePath, { start, end }).pipe(res);
      }
    }
  }

  res.writeHead(200, { ...headers, 'Content-Length': fileStat.size });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url.pathname);
    }
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: 'Internal server error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`KOSTYUK PROJECT server started on port ${port}`);
});
