/**
 * Подпись и разбор вебхуков Prodamus.
 * Алгоритм (подтверждён офиц. докой Prodamus, callbackType=json НЕ используем):
 *   1. рекурсивно отсортировать ключи по алфавиту (включая вложенные объекты/массивы)
 *   2. все скаляры → строки (null/undefined → "")
 *   3. JSON.stringify без пробелов
 *   4. "/" → "\/"  (PHP json_encode так делает по умолчанию, JS — нет; без этого
 *      подпись почти никогда не сходится, т.к. в payload почти всегда есть URL)
 *   5. HMAC-SHA256(payload, secret) в hex
 *   6. сравнить с заголовком Sign
 */
import crypto from 'crypto';

function sortRecursive(data) {
  if (Array.isArray(data)) return data.map(sortRecursive);
  if (data !== null && typeof data === 'object') {
    const out = {};
    Object.keys(data).sort().forEach(k => { out[k] = sortRecursive(data[k]); });
    return out;
  }
  if (data === null || data === undefined) return '';
  // Срезаем только хвостовые переводы строк — form-urlencoded может добавить
  // \n, которого не было в подписанном значении. Обычные пробелы значимы.
  return String(data).replace(/[\r\n]+$/, '');
}

function compactJson(data) {
  return JSON.stringify(data).replace(/\//g, '\\/');
}

function hmacSha256Hex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Строит подпись для произвольного объекта payload (для сверки/тестов). */
function buildProdamusSignature(payload, secret) {
  const canonical = compactJson(sortRecursive(payload));
  return hmacSha256Hex(secret, canonical);
}

/** Сравнение подписи вебхука с расчётной. Timing-safe. */
function verifyProdamusSignature(payload, receivedSign, secret) {
  const received = String(receivedSign || '').trim().toLowerCase();
  if (!received || !secret) return false;
  const calculated = buildProdamusSignature(payload, secret).toLowerCase();
  if (received.length !== calculated.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(calculated, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Разбор form-urlencoded тела с PHP-нотацией в объект:
 *   order_num=x&subscription[id]=1&products[0][name]=a&products[0][price]=10
 * → { order_num: 'x', subscription: { id: '1' }, products: [{ name: 'a', price: '10' }] }
 * Разреженные индексы массива уплотняются (.filter(Boolean)), иначе дырка
 * станет null в JSON.stringify и подпись не сойдётся.
 */
function parseProdamusFormBody(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const result = {};
  for (const [rawKey, value] of new URLSearchParams(text).entries()) {
    const arrayMatch = rawKey.match(/^([^[\]]+)\[(\d+)\]\[([^[\]]+)\]$/);
    if (arrayMatch) {
      const [, parent, idx, field] = arrayMatch;
      if (!Array.isArray(result[parent])) result[parent] = [];
      const i = parseInt(idx, 10);
      if (!result[parent][i]) result[parent][i] = {};
      result[parent][i][field] = value;
      continue;
    }
    const objMatch = rawKey.match(/^([^[\]]+)\[([^[\]]+)\]$/);
    if (objMatch) {
      const [, parent, field] = objMatch;
      if (!result[parent] || Array.isArray(result[parent])) result[parent] = {};
      result[parent][field] = value;
      continue;
    }
    result[rawKey] = value;
  }
  for (const key of Object.keys(result)) {
    if (Array.isArray(result[key])) result[key] = result[key].filter(Boolean);
  }
  return result;
}

/** Self-test алгоритма подписи. Бросает исключение при расхождении. */
function selfTestProdamusSign() {
  const secret = 'test_secret_key';
  const payload = {
    order_num: 'BK-ABC123-att1',
    sum: '1800',
    products: [{ name: 'Билет «Секрет»', price: '1800', quantity: '1' }],
    url_return: 'https://example.com/return'
  };
  const sig = buildProdamusSignature(payload, secret);
  if (!/^[a-f0-9]{64}$/.test(sig)) throw new Error('prodamus self-test: bad signature format');
  if (!verifyProdamusSignature(payload, sig, secret)) throw new Error('prodamus self-test: verify failed on own signature');
  if (verifyProdamusSignature(payload, sig, 'wrong_secret')) throw new Error('prodamus self-test: verify passed with wrong secret');
  const tampered = { ...payload, sum: '1' };
  if (verifyProdamusSignature(tampered, sig, secret)) throw new Error('prodamus self-test: verify passed on tampered payload');
  // Слеш в значении обязан экранироваться — проверяем что compactJson реально это делает.
  const canonical = compactJson(sortRecursive(payload));
  if (!canonical.includes('\\/\\/')) throw new Error('prodamus self-test: slash escaping not applied');
  return true;
}

export {
  sortRecursive,
  compactJson,
  buildProdamusSignature,
  verifyProdamusSignature,
  parseProdamusFormBody,
  selfTestProdamusSign
};
