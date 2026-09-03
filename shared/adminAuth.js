import crypto from 'crypto';

const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';

const SECURE_PASS_PATH = 'ticket_admin/adminPassword';
const LEGACY_PASS_PATH = 'ticket_config/adminPassword';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };
const ALLOW_ADMIN_PASSWORD_IN_BODY = String(process.env.ALLOW_ADMIN_PASSWORD_IN_BODY || '').trim().toLowerCase() === 'true';
const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILURES = 8;
const AUTH_FAILURE_BUCKET_LIMIT = 2000;
const authFailures = new Map();

function headerString(req, key) {
  const value = req?.headers?.[key];
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
}

function decodeBase64Utf8(raw) {
  if (!raw) return '';
  try {
    return Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function readAdminPass(req, body) {
  const rawPass = headerString(req, 'x-admin-pass');
  if (rawPass) return rawPass;
  const b64Pass = decodeBase64Utf8(headerString(req, 'x-admin-pass-b64'));
  if (b64Pass) return b64Pass;
  if (ALLOW_ADMIN_PASSWORD_IN_BODY) {
    return typeof body?.adminPassword === 'string' ? body.adminPassword : '';
  }
  return '';
}

function adminAttemptKey(req) {
  const forwarded = headerString(req, 'x-real-ip')
    || headerString(req, 'cf-connecting-ip')
    || headerString(req, 'x-forwarded-for').split(',')[0];
  const raw = forwarded || req?.socket?.remoteAddress || 'unknown';
  return String(raw).trim().slice(0, 64) || 'unknown';
}

function pruneAuthFailures(now) {
  for (const [key, state] of authFailures) {
    if (state.resetAt <= now) authFailures.delete(key);
  }
  while (authFailures.size > AUTH_FAILURE_BUCKET_LIMIT) {
    authFailures.delete(authFailures.keys().next().value);
  }
}

function isAdminAttemptBlocked(key, now = Date.now()) {
  const state = authFailures.get(key);
  if (!state || state.resetAt <= now) {
    if (state) authFailures.delete(key);
    return false;
  }
  return state.failures >= AUTH_MAX_FAILURES;
}

function recordAdminFailure(key, now = Date.now()) {
  pruneAuthFailures(now);
  const previous = authFailures.get(key);
  const state = !previous || previous.resetAt <= now
    ? { failures: 0, resetAt: now + AUTH_FAILURE_WINDOW_MS }
    : previous;
  state.failures += 1;
  authFailures.set(key, state);
}

// ── Firebase helpers ──

async function readFirebaseJson(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || (data && typeof data === 'object' && data.error)) {
    throw new Error(`Firebase request failed (${response.status})`);
  }
  return data;
}

async function fbGet(path) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
  return await readFirebaseJson(r);
}

async function fbPut(path, data) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  await readFirebaseJson(r);
}

async function fbDelete(path) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, { method: 'DELETE' });
  await readFirebaseJson(r);
}

// ── Хеширование паролей (scrypt, встроен в Node.js) ──

function isHashedPassword(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt:');
}

function hashPassword(plaintext) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(plaintext, salt, SCRYPT_KEYLEN, SCRYPT_COST, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${key.toString('hex')}`);
    });
  });
}

function verifyPassword(plaintext, stored) {
  return new Promise((resolve, reject) => {
    if (!isHashedPassword(stored)) {
      // Plaintext fallback (до миграции): timing-safe сравнение
      const bufA = Buffer.from(plaintext, 'utf8');
      const bufB = Buffer.from(stored, 'utf8');
      if (bufA.length !== bufB.length) return resolve(false);
      return resolve(crypto.timingSafeEqual(bufA, bufB));
    }
    const parts = stored.split(':');
    if (parts.length !== 3) return resolve(false);
    const [, salt, hash] = parts;
    crypto.scrypt(plaintext, salt, SCRYPT_KEYLEN, SCRYPT_COST, (err, key) => {
      if (err) return reject(err);
      const expectedBuf = Buffer.from(hash, 'hex');
      const actualBuf = key;
      if (expectedBuf.length !== actualBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(expectedBuf, actualBuf));
    });
  });
}

// ── Управление паролем ──

async function getAdminPassword() {
  const securePass = await fbGet(SECURE_PASS_PATH);
  return securePass && typeof securePass === 'string' ? securePass : null;
}

// Кэш успешных проверок пароля (см. isAdminAuthorized ниже). Объявлен здесь, чтобы
// setAdminPassword мог его сбросить при смене пароля.
const AUTH_OK_CACHE = new Map(); // passHash -> expiresAt
const AUTH_OK_TTL_MS = 90 * 1000;

function fastHash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

async function setAdminPassword(newPass) {
  const hashed = await hashPassword(newPass);
  await fbPut(SECURE_PASS_PATH, hashed);
  try { await fbDelete(LEGACY_PASS_PATH); } catch { }
  // Сбрасываем кэш успешных проверок — старый пароль не должен работать после смены.
  AUTH_OK_CACHE.clear();
}

// Кэш успешных проверок пароля ускоряет админку: без него каждый запрос читал бы
// пароль из Firebase и гонял scrypt (~80-150мс) — при загрузке дашборда это несколько
// запросов подряд. Кэшируем ТОЛЬКО успех, по быстрому хэшу присланного пароля, на
// короткий TTL. Безопасно: неверный пароль всегда идёт полным путём; при смене пароля
// кэш очищается (setAdminPassword) и старый хэш не совпадёт; TTL короткий.
async function isAdminAuthorized(req, body) {
  const adminPass = readAdminPass(req, body);
  if (!adminPass) return false;
  const attemptKey = adminAttemptKey(req);
  if (isAdminAttemptBlocked(attemptKey)) return false;

  // Быстрый путь: этот же пароль уже подтверждён недавно.
  const passHash = fastHash(adminPass);
  const cachedUntil = AUTH_OK_CACHE.get(passHash);
  if (cachedUntil && cachedUntil > Date.now()) {
    return true;
  }
  if (cachedUntil) AUTH_OK_CACHE.delete(passHash); // протух

  const storedPass = await getAdminPassword();
  if (!storedPass || typeof storedPass !== 'string') {
    recordAdminFailure(attemptKey);
    return false;
  }

  const ok = await verifyPassword(adminPass, storedPass);
  if (ok) AUTH_OK_CACHE.set(passHash, Date.now() + AUTH_OK_TTL_MS);

  if (ok) authFailures.delete(attemptKey);
  else recordAdminFailure(attemptKey);

  // Автомиграция: если пароль ещё plaintext — хешируем при успешном логине
  if (ok && !isHashedPassword(storedPass)) {
    try {
      const hashed = await hashPassword(adminPass);
      await fbPut(SECURE_PASS_PATH, hashed);
    } catch { }
  }

  return ok;
}

export {
  getAdminPassword,
  setAdminPassword,
  isAdminAuthorized,
  readAdminPass,
  verifyPassword,
  hashPassword,
  isHashedPassword,
  SECURE_PASS_PATH
};
