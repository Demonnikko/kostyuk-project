import crypto from 'node:crypto';

const VK_APP_ID = '54751520';

/**
 * Разбирает вход в упорядоченный список [key, value] пар.
 * Принимает: строку query ("?a=1&b=2" или "a=1&b=2"), URLSearchParams или объект.
 * Важно: НЕ используем URLSearchParams.toString() для сборки подписи —
 * VK требует encodeURIComponent (пробел => %20), а URLSearchParams даёт "+".
 */
function toEntries(value) {
  if (value instanceof URLSearchParams) {
    return [...value.entries()];
  }
  if (typeof value === 'string') {
    const raw = value.startsWith('?') ? value.slice(1) : value;
    if (!raw) return [];
    return raw.split('&').map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return [decodeURIComponent(pair), ''];
      const key = decodeURIComponent(pair.slice(0, eq));
      const val = decodeURIComponent(pair.slice(eq + 1));
      return [key, val];
    });
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).map((k) => [k, String(value[k])]);
  }
  return [];
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Проверяет подпись launch parameters VK Mini App по официальному алгоритму:
 * https://dev.vk.com/ru/mini-apps/development/launch-params-sign
 *
 * 1. Берём только параметры с префиксом vk_.
 * 2. Сортируем по имени ключа (ascending).
 * 3. Собираем строку "key=encodeURIComponent(value)" через "&".
 * 4. HMAC-SHA256(secret, строка) -> base64 -> +→-, /→_, убрать хвостовые "=".
 * 5. Сравниваем с параметром sign.
 *
 * ВАЖНО: VK НЕ присылает vk_ts в launch params. Срок жизни доверенного
 * состояния ограничивается на нашей стороне через короткоживущую серверную
 * сессию (session endpoint), а не через параметры запуска.
 */
export function verifyVkLaunchParams(searchParams, secret) {
  const entries = toEntries(searchParams);

  let sign = '';
  const vkParams = [];
  let appId = '';
  let userId = '';
  for (const [key, value] of entries) {
    if (key === 'sign') {
      sign = value;
    } else if (key.startsWith('vk_')) {
      vkParams.push([key, value]);
      if (key === 'vk_app_id') appId = value;
      if (key === 'vk_user_id') userId = value;
    }
  }

  if (!secret || !sign || vkParams.length === 0 || !appId || !userId) {
    return { ok: false, userId: null, appId: appId || null, reason: 'invalid_params' };
  }

  const queryString = vkParams
    .slice()
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value], idx) => `${idx === 0 ? '' : '&'}${key}=${encodeURIComponent(value)}`)
    .join('');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(queryString)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (!constantTimeEqual(sign, expected)) {
    return { ok: false, userId: null, appId, reason: 'invalid_signature' };
  }
  if (appId !== VK_APP_ID) {
    return { ok: false, userId: null, appId, reason: 'wrong_app_id' };
  }

  return { ok: true, userId, appId, reason: null };
}

export { VK_APP_ID };
