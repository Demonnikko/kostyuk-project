import crypto from 'crypto';

const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';

const SECURE_PASS_PATH = 'ticket_admin/adminPassword';
const LEGACY_PASS_PATH = 'ticket_config/adminPassword';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };
const ALLOW_ADMIN_PASSWORD_IN_BODY = String(process.env.ALLOW_ADMIN_PASSWORD_IN_BODY || '').trim().toLowerCase() === 'true';

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

// ── Firebase helpers ──

async function fbGet(path) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
  return await r.json();
}

async function fbPut(path, data) {
  await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function fbDelete(path) {
  await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, { method: 'DELETE' });
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

async function setAdminPassword(newPass) {
  const hashed = await hashPassword(newPass);
  await fbPut(SECURE_PASS_PATH, hashed);
  try { await fbDelete(LEGACY_PASS_PATH); } catch { }
}

async function isAdminAuthorized(req, body) {
  const adminPass = readAdminPass(req, body);
  if (!adminPass) return false;
  const storedPass = await getAdminPassword();
  if (!storedPass || typeof storedPass !== 'string') return false;

  const ok = await verifyPassword(adminPass, storedPass);

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
