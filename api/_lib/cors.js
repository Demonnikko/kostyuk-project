/**
 * CORS-хелпер.
 * — Публичные GET-эндпоинты (ticket-data, ticket-booking, widget-image) → разрешаем всем.
 * — Мутирующие POST-эндпоинты (book, notify, huligan, broadcast) → только доверенные домены.
 */

const ALLOWED_ORIGINS = new Set([
  'https://vk-tickets.vercel.app',
  'https://vk.com',
  'https://m.vk.com',
  'https://oauth.vk.com',
]);

// Также разрешаем Vercel preview-деплои (*.vercel.app)
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Vercel preview deployments: <project>-<hash>-<scope>.vercel.app
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

/**
 * Устанавливает CORS-заголовки.
 * @param {object} req
 * @param {object} res
 * @param {object} opts
 * @param {boolean} [opts.publicRead=false] — если true, разрешает любой origin (для GET-only эндпоинтов)
 * @param {string}  [opts.methods='POST, OPTIONS'] — разрешённые HTTP-методы
 */
function setCors(req, res, opts = {}) {
  const origin = req.headers?.origin || '';
  const methods = opts.methods || 'POST, OPTIONS';

  if (opts.publicRead) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // Не ставим Access-Control-Allow-Origin — браузер заблокирует запрос
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pass, x-admin-pass-b64');
  // Динамические API-ответы не кэшируем, чтобы в мини-аппах не всплывали старые статусы/конфиги.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

module.exports = { setCors, isAllowedOrigin };
