import crypto from 'crypto';
import https from 'https';
import { RUSSIAN_CA_BUNDLE } from '../../shared/russianCaBundle.js';

// securepay.tinkoff.ru использует сертификат «Минцифры России», которого нет
// в стандартном доверенном хранилище Node.js — без явного CA fetch() падает
// с SELF_SIGNED_CERT_IN_CHAIN на любой инфраструктуре вне России (Vercel и т.п.).
const tbankHttpsAgent = new https.Agent({ ca: RUSSIAN_CA_BUNDLE });

const FB_URL = process.env.FIREBASE_DB_URL || '';
const VK_TOKEN = process.env.VK_TOKEN || '';
const ADMIN_ID = parseInt(process.env.ADMIN_VK_ID) || 196783025;
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const TICKET_LINK_SECRET = process.env.TICKET_LINK_SECRET || '';
// На preview-деплоях (у каждого свой временный URL) используем VERCEL_URL
// автоматически — иначе SuccessURL/NotificationURL для T-Bank всегда вели бы
// на прод-домен, и вебхук об оплате никогда не находил бы preview-бронь.
const TICKET_PUBLIC_ORIGIN = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.TICKET_PUBLIC_ORIGIN || 'https://vk-tickets.vercel.app');
import {  isAdminAuthorized  } from '../../shared/adminAuth.js';
import {  sendEmail, buildTicketEmailHtml  } from '../../shared/email.js';
import {  renderTicketImage  } from '../../shared/ticketImage.js';
const MINI_APP_BASE = process.env.VK_TICKETS_MINI_APP_URL || 'https://vk.com/app54466228_-209268664';
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const TELEGRAM_ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.ADMIN_TELEGRAM_CHAT_ID || '').trim();
const TELEGRAM_HULIGAN_WEBAPP_URL = (process.env.TELEGRAM_HULIGAN_WEBAPP_URL || `${TICKET_PUBLIC_ORIGIN}/huligan.html`).trim();
const ADMIN_PANEL_URL = (process.env.HULIGAN_ADMIN_PANEL_URL || 'https://vk-tickets.vercel.app/admin.html').trim();
const TG_INITDATA_MAX_AGE_SEC = Number(process.env.TG_INITDATA_MAX_AGE_SEC || 86400);
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';
const TBANK_HULIGAN_ENABLED_RAW = String(process.env.TBANK_HULIGAN_ENABLED || '').trim().toLowerCase();
const TBANK_HULIGAN_TEST_ENABLED_RAW = String(process.env.TBANK_HULIGAN_TEST_ENABLED || '').trim().toLowerCase();
const TBANK_FORCE_TEST_MODE_RAW = String(process.env.TBANK_FORCE_TEST_MODE || '').trim().toLowerCase();
const TBANK_TERMINAL_KEY = String(process.env.TBANK_TERMINAL_KEY || '').trim();
const TBANK_TERMINAL_PASSWORD = String(process.env.TBANK_TERMINAL_PASSWORD || '').trim();
const TBANK_TERMINAL_KEY_TEST = String(process.env.TBANK_TERMINAL_KEY_TEST || '').trim();
const TBANK_TERMINAL_PASSWORD_TEST = String(process.env.TBANK_TERMINAL_PASSWORD_TEST || '').trim();
const TBANK_NOTIFY_URL = String(process.env.TBANK_HULIGAN_NOTIFY_URL || `${TICKET_PUBLIC_ORIGIN}/api/huligan?action=tbank_notify`).trim();
const TBANK_SUCCESS_URL = String(process.env.TBANK_HULIGAN_SUCCESS_URL || `${TICKET_PUBLIC_ORIGIN}/concerts/huligan/index.html?pay=success`).trim();
const TBANK_FAIL_URL = String(process.env.TBANK_HULIGAN_FAIL_URL || `${TICKET_PUBLIC_ORIGIN}/concerts/huligan/index.html?pay=fail`).trim();
const TBANK_API_TEST_BASE = 'https://securepay.tinkoff.ru/v2';
const TBANK_API_PROD_BASE = 'https://securepay.tinkoff.ru/v2';
import {  runHuliganAutoCleanup  } from '../../shared/autoCleanup.js';

const BLOCKED_STATUSES = new Set(['cancelled', 'refunded', 'returned', 'deleted']);

// ── HMAC ticket token helpers ──
function b64urlEncode(input) { return Buffer.from(input).toString('base64url'); }
function b64urlDecode(input) { return Buffer.from(input, 'base64url').toString('utf8'); }
function signPayload(payloadB64) {
  if (!TICKET_LINK_SECRET) throw new Error('TICKET_LINK_SECRET not set');
  return crypto.createHmac('sha256', TICKET_LINK_SECRET).update(payloadB64).digest('base64url');
}
function makeHuliganToken(bookingId, version, ttlHours = 24 * 45) {
  const exp = Date.now() + ttlHours * 3600000;
  const payloadB64 = b64urlEncode(JSON.stringify({ bid: String(bookingId), v: Number(version) || 1, exp, show: 'huligan' }));
  return { token: `${payloadB64}.${signPayload(payloadB64)}`, expiresAt: exp };
}
function verifyHuliganToken(token, bookingId) {
  if (!token || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false };
  const [payloadB64, sig] = parts;
  const expectedSig = signPayload(payloadB64);
  const sigBuf = Buffer.from(sig); const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return { ok: false };
  try {
    const p = JSON.parse(b64urlDecode(payloadB64));
    if (!p || !p.bid || !p.exp) return { ok: false };
    if (Date.now() > Number(p.exp)) return { ok: false, code: 'expired' };
    if (String(p.bid) !== String(bookingId)) return { ok: false };
    return { ok: true, payload: p };
  } catch { return { ok: false }; }
}

const TYPE_NAMES = { vip: 'Красная зона', std: 'Зелёная зона', eco: 'Синяя зона' };
const BOOKING_ID_RE = /^[A-Z0-9-]{4,40}$/i;

function randomFromAlphabet(length, alphabet) {
  let out = '';
  const max = alphabet.length;
  for (let i = 0; i < length; i++) {
    out += alphabet[crypto.randomInt(0, max)];
  }
  return out;
}

function genClientKey() {
  return crypto.randomBytes(24).toString('hex');
}

function genAdminBookingId(prefix) {
  const stamp = Date.now().toString(36).toUpperCase();
  const tail = randomFromAlphabet(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  return `${prefix}-${stamp}${tail}`;
}

function genTicketNum() {
  return `HUL-${randomFromAlphabet(5, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')}`;
}


function buildHuliganSeatKey(tableValue, seatValue) {
  const tableText = String(tableValue ?? '').trim();
  const seatText = String(seatValue ?? '').trim();
  const tableNum = (tableText.match(/\d+/) || [])[0];
  const seatNum = (seatText.match(/\d+/) || [])[0];
  if (!tableText && !seatText) return '0_0';
  if (/^c_\d+$/i.test(tableText)) return tableText.toLowerCase();
  if (/^t\d+$/i.test(tableText) && seatNum) return `${tableText.toLowerCase()}_${seatNum}`;
  if (/стуль/i.test(tableText) && seatNum) return `c_${seatNum}`;
  if ((/^стол/i.test(tableText) || /^\d+$/.test(tableText)) && tableNum && seatNum) return `t${tableNum}_${seatNum}`;
  return `${tableText || '0'}_${seatText || '0'}`;
}

function normalizeHuliganSeatKey(seat) {
  if (!seat || typeof seat !== 'object') return '0_0';
  const direct = String(seat.key || '').trim();
  if (direct) return direct;
  return buildHuliganSeatKey(seat.tableId ?? seat.table, seat.seatIdx ?? seat.seatNum);
}

function parseIncomingBody(rawBody) {
  if (rawBody == null) return {};
  if (Buffer.isBuffer(rawBody)) {
    return parseIncomingBody(rawBody.toString('utf8'));
  }
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return {};
    try {
      const parsedJson = JSON.parse(trimmed);
      if (parsedJson && typeof parsedJson === 'object') return parsedJson;
    } catch { }
    try {
      const params = new URLSearchParams(trimmed);
      const parsedForm = {};
      for (const [k, v] of params.entries()) parsedForm[k] = v;
      if (Object.keys(parsedForm).length) return parsedForm;
    } catch { }
    return {};
  }
  if (typeof rawBody === 'object') {
    return rawBody;
  }
  return {};
}

function shouldUseTBankTestMode() {
  if (TBANK_FORCE_TEST_MODE_RAW === 'true' || TBANK_FORCE_TEST_MODE_RAW === '1' || TBANK_FORCE_TEST_MODE_RAW === 'yes') return true;
  if (TBANK_FORCE_TEST_MODE_RAW === 'false' || TBANK_FORCE_TEST_MODE_RAW === '0' || TBANK_FORCE_TEST_MODE_RAW === 'no') return false;
  // Без явного флага предпочитаем тестовый терминал, чтобы не списывать реальные деньги случайно.
  return Boolean(TBANK_TERMINAL_KEY_TEST && TBANK_TERMINAL_PASSWORD_TEST);
}

function getTBankCredentials() {
  const testMode = shouldUseTBankTestMode();
  const terminalKey = testMode ? TBANK_TERMINAL_KEY_TEST : TBANK_TERMINAL_KEY;
  const password = testMode ? TBANK_TERMINAL_PASSWORD_TEST : TBANK_TERMINAL_PASSWORD;
  return {
    testMode,
    terminalKey,
    password,
    apiBase: testMode ? TBANK_API_TEST_BASE : TBANK_API_PROD_BASE
  };
}

function isTBankConfigured() {
  const creds = getTBankCredentials();
  return Boolean(creds.terminalKey && creds.password);
}

function isTruthyFlag(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function isTBankTestGloballyEnabled() {
  return isTruthyFlag(TBANK_HULIGAN_TEST_ENABLED_RAW) && isTBankConfigured();
}

function isAdminTelegramUser(body = {}) {
  const trusted = Number(body?._trustedTgUserId || 0);
  const adminTg = Number(TELEGRAM_ADMIN_CHAT_ID || 0);
  return Number.isFinite(trusted) && trusted > 0 && Number.isFinite(adminTg) && adminTg > 0 && trusted === adminTg;
}

function isTBankTestRequested(body = {}) {
  const raw = String(body?.tbankTest || body?.tbank_test || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function canUseTBankTestTools(body = {}) {
  return isTBankTestGloballyEnabled() && isAdminTelegramUser(body);
}

function isTBankEnabledForRequest(body = {}, { forWebhook = false } = {}) {
  if (TBANK_HULIGAN_ENABLED_RAW === 'true' || TBANK_HULIGAN_ENABLED_RAW === '1' || TBANK_HULIGAN_ENABLED_RAW === 'yes') {
    return isTBankConfigured();
  }
  if (TBANK_HULIGAN_ENABLED_RAW === 'false' || TBANK_HULIGAN_ENABLED_RAW === '0' || TBANK_HULIGAN_ENABLED_RAW === 'no') {
    if (forWebhook) return isTBankTestGloballyEnabled();
    return canUseTBankTestTools(body);
  }
  if (forWebhook) return isTBankConfigured();
  // Если глобальный флаг не задан, обычный режим работает как раньше.
  // Тестовый режим доступен только администратору Telegram.
  return isTBankConfigured() || canUseTBankTestTools(body);
}

async function isHuliganSalesPaused() {
  const showCfg = await fbGet('huligan_config/show');
  return Boolean(showCfg && showCfg.salesPaused === true);
}

function buildTBankToken(params, password) {
  const bag = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'Token' || v == null) continue;
    if (typeof v === 'object') continue;
    bag[k] = String(v);
  }
  bag.Password = String(password || '');
  const source = Object.keys(bag)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => bag[k])
    .join('');
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function verifyTBankToken(payload, password) {
  const incoming = String(payload?.Token || '').trim().toLowerCase();
  if (!incoming || !password) return false;
  const calc = buildTBankToken(payload, password).toLowerCase();
  const a = Buffer.from(incoming, 'utf8');
  const b = Buffer.from(calc, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Node fetch() (undici) не принимает https.Agent напрямую — используем
// https.request() с явным CA-бандлом, чтобы securepay.tinkoff.ru прошёл
// проверку сертификата на любой инфраструктуре (см. tbankHttpsAgent выше).
function tbankHttpsPost(url, payload, timeoutMs) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      agent: tbankHttpsAgent,
      timeout: timeoutMs
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch { }
        resolve({ httpOk: res.statusCode >= 200 && res.statusCode < 300, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => {
      resolve({ httpOk: false, data: { Success: false, Message: err?.message || 'Network error' } });
    });
    req.write(body);
    req.end();
  });
}

async function tbankApi(method, body, creds) {
  const payload = { ...(body || {}), TerminalKey: creds.terminalKey };
  payload.Token = buildTBankToken(payload, creds.password);
  return tbankHttpsPost(`${creds.apiBase}/${String(method || '').trim()}`, payload, 9000);
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

function timingSafeEqHex(a, b) {
  const aHex = String(a || '').trim().toLowerCase();
  const bHex = String(b || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(aHex) || !/^[a-f0-9]{64}$/.test(bHex)) return false;
  const aBuf = Buffer.from(aHex, 'hex');
  const bBuf = Buffer.from(bHex, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyTelegramInitData(initDataRaw) {
  if (!initDataRaw || !TELEGRAM_BOT_TOKEN) return { ok: false, code: 'missing' };
  try {
    const params = new URLSearchParams(String(initDataRaw));
    const hash = params.get('hash') || '';
    if (!hash) return { ok: false, code: 'no_hash' };
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(TELEGRAM_BOT_TOKEN)
      .digest();
    const calcHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (!timingSafeEqHex(hash, calcHash)) return { ok: false, code: 'bad_hash' };

    const authDate = Number(params.get('auth_date') || 0);
    if (
      authDate > 0 &&
      Number.isFinite(TG_INITDATA_MAX_AGE_SEC) &&
      TG_INITDATA_MAX_AGE_SEC > 0 &&
      (Date.now() / 1000 - authDate) > TG_INITDATA_MAX_AGE_SEC
    ) {
      return { ok: false, code: 'expired' };
    }

    const userRaw = params.get('user');
    if (!userRaw) return { ok: false, code: 'no_user' };
    const user = JSON.parse(userRaw);
    const userId = Number(user?.id || 0);
    if (!Number.isFinite(userId) || userId <= 0) return { ok: false, code: 'bad_user' };
    return { ok: true, userId, user };
  } catch {
    return { ok: false, code: 'invalid' };
  }
}

function getTrustedTelegramUserId(initDataRaw) {
  const v = verifyTelegramInitData(initDataRaw);
  return v.ok ? Number(v.userId) : null;
}

async function fbGet(path) {
  const { signal, clear } = withTimeout(8000);
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, { signal });
    clear();
    return await r.json();
  } catch { clear(); return null; }
}

async function fbGetWithETag(path) {
  const sep = FIREBASE_SECRET ? '&' : '?';
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}${sep}X-Firebase-ETag=true`, {
      headers: { 'X-Firebase-ETag': 'true' }
    });
    if (!r.ok) return { data: null, etag: null };
    return { data: await r.json(), etag: r.headers.get('etag') };
  } catch { return { data: null, etag: null }; }
}

async function fbConditionalPut(path, data, etag) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(data)
    });
    return r.status !== 412;
  } catch { return false; }
}

async function fbPatch(path, data) {
  const { signal, clear } = withTimeout(8000);
  try {
    await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal
    });
    clear();
  } catch { clear(); }
}

async function fbPut(path, data) {
  const { signal, clear } = withTimeout(8000);
  try {
    await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal
    });
    clear();
  } catch { clear(); }
}

function getNotifyMeta(booking) {
  if (booking && typeof booking.notifyMeta === 'object' && booking.notifyMeta) {
    return booking.notifyMeta;
  }
  return {};
}

function hasNotifyFlag(booking, key) {
  return Number(getNotifyMeta(booking)[key] || 0) > 0;
}

async function markNotifyFlag(bookingId, booking, key) {
  const nextMeta = { ...getNotifyMeta(booking), [key]: Date.now() };
  booking.notifyMeta = nextMeta;
  await fbPatch(`huligan_bookings/${bookingId}`, { notifyMeta: nextMeta });
}

function isSafeBookingPath(path) {
  if (typeof path !== 'string') return false;
  const m = path.match(/^huligan_bookings\/([^/]+)$/);
  if (!m) return false;
  return BOOKING_ID_RE.test(m[1]);
}

function validateBookingCreate(path, data) {
  if (!isSafeBookingPath(path) || !data || typeof data !== 'object') return false;
  const id = path.split('/')[1];
  if (String(data.bookingId || '') !== id) return false;
  if (!String(data.clientKey || '').trim() || String(data.clientKey).length < 10) return false;
  if (!String(data.name || '').trim()) return false;
  if (!/^[a-z0-9_-]{1,30}$/i.test(String(data.ticketType || ''))) return false;
  if (data.status !== 'new') return false;
  if (!Number.isFinite(Number(data.createdAt))) return false;
  const fp = Number(data.finalPrice);
  const op = Number(data.originalPrice);
  if (!Number.isFinite(fp) || fp < 0) return false;
  if (!Number.isFinite(op) || op < 0) return false;
  if (data.vkUserId != null && !Number.isFinite(Number(data.vkUserId))) return false;
  if (data.tgUserId != null && !Number.isFinite(Number(data.tgUserId))) return false;
  if (data.tgUsername != null && !/^@?[a-zA-Z0-9_]{3,64}$/.test(String(data.tgUsername))) return false;
  return true;
}

function validateBookingPatch(path, data) {
  if (!isSafeBookingPath(path) || !data || typeof data !== 'object') return false;
  const keys = Object.keys(data);
  const allowed = ['status', 'paidAt', 'clientKey', 'vkUserId', 'tgUserId'];
  if (!keys.length || keys.some(k => !allowed.includes(k))) return false;
  if (data.status !== 'waiting_admin') return false;
  if (!Number.isFinite(Number(data.paidAt))) return false;
  if (data.clientKey !== undefined && (!String(data.clientKey).trim() || String(data.clientKey).length < 10)) return false;
  if (data.vkUserId !== undefined && !Number.isFinite(Number(data.vkUserId))) return false;
  if (data.tgUserId !== undefined && !Number.isFinite(Number(data.tgUserId))) return false;
  return true;
}

async function vkSend(userId, text) {
  if (!VK_TOKEN) return { error: { error_msg: 'VK_TOKEN is not configured' } };
  const params = new URLSearchParams({
    peer_id: userId,
    message: text,
    random_id: crypto.randomInt(1, 2_000_000_000),
    access_token: VK_TOKEN,
    v: '5.199'
  });
  const r = await fetch('https://api.vk.com/method/messages.send', { method: 'POST', body: params });
  const data = await r.json();
  if (data.error) console.error('[huligan] vkSend error:', JSON.stringify(data.error));
  return data;
}

async function tgSend(chatId, text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false, error: { description: 'TELEGRAM_BOT_TOKEN/CHAT_ID is not configured' } };
  try {
    const payload = {
      chat_id: String(chatId),
      text: String(text),
      disable_web_page_preview: true
    };
    if (opts && typeof opts === 'object') {
      if (opts.reply_markup) payload.reply_markup = opts.reply_markup;
      if (opts.parse_mode) payload.parse_mode = String(opts.parse_mode);
    }
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!data.ok) console.error('[huligan] tgSend error:', JSON.stringify(data));
    return data;
  } catch (e) {
    console.error('[huligan] tgSend exception:', e.message);
    return { ok: false, error: { description: e.message } };
  }
}

async function notifyAdmin(text) {
  const jobs = [];
  if (VK_TOKEN && Number.isFinite(ADMIN_ID) && ADMIN_ID > 0) jobs.push(vkSend(ADMIN_ID, text).catch(() => ({ ok: false })));
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) jobs.push(tgSend(TELEGRAM_ADMIN_CHAT_ID, text).catch(() => ({ ok: false })));
  if (!jobs.length) return [];
  return Promise.all(jobs);
}

async function saveAdminNotification(text, event, bookingId) {
  try {
    const key = `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    await fbPut(`admin_notifications/${key}`, {
      text: String(text || ''),
      event: String(event || ''),
      bookingId: bookingId ? String(bookingId) : null,
      ts: Date.now(),
      read: false
    });
  } catch {}
}

function buildHuliganMiniAppTicketLink(bookingId = '') {
  const params = new URLSearchParams({ hash: 'huligan', tab: 'tickets' });
  if (bookingId) params.set('bookingId', String(bookingId));
  const hash = bookingId ? `#huligan/tickets/${encodeURIComponent(String(bookingId))}` : '#huligan/tickets';
  return `${MINI_APP_BASE}?${params.toString()}${hash}`;
}

function buildHuliganTelegramTicketLink(bookingId = '') {
  try {
    const url = new URL(TELEGRAM_HULIGAN_WEBAPP_URL);
    if (bookingId) {
      url.searchParams.set('tab', 'tickets');
      url.searchParams.set('bookingId', String(bookingId));
    }
    return url.toString();
  } catch {
    const hasQuery = TELEGRAM_HULIGAN_WEBAPP_URL.includes('?');
    if (!bookingId) return TELEGRAM_HULIGAN_WEBAPP_URL;
    return `${TELEGRAM_HULIGAN_WEBAPP_URL}${hasQuery ? '&' : '?'}tab=tickets&bookingId=${encodeURIComponent(String(bookingId))}`;
  }
}

async function tgSendTicketReady(chatId, bookingId) {
  const tgLink = buildHuliganTelegramTicketLink(bookingId);
  const primary = await tgSend(
    chatId,
    'Теперь ты тоже хулиган, а вот твой билет 👇',
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '🎟 Мой билет', web_app: { url: tgLink } }
        ]]
      }
    }
  ).catch(() => ({ ok: false }));
  if (primary && primary.ok) return primary;
  return tgSend(chatId, `Теперь ты тоже хулиган, а вот твой билет: ${tgLink}`);
}

async function findBookingByTBankOrderId(orderId) {
  const all = await fbGet('huligan_bookings');
  if (!all || typeof all !== 'object') return null;
  for (const [id, booking] of Object.entries(all)) {
    const bOrder = String(booking?.tbank?.orderId || '');
    if (bOrder && bOrder === String(orderId)) {
      return { bookingId: String(booking.bookingId || id), booking };
    }
  }
  return null;
}

export async function confirmBookingAndNotify(bookingId, ignoredBooking, meta = {}) {
  let ticketNumber = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: booking, etag } = await fbGetWithETag(`huligan_bookings/${bookingId}`);
    if (!booking) return { ok: false, error: 'Booking not found' };

    const curStatus = String(booking.status || '').toLowerCase();
    if (BLOCKED_STATUSES.has(curStatus)) return { ok: false, error: `Cannot confirm: status is '${curStatus}'` };

    if (curStatus === 'confirmed') {
      ticketNumber = String(booking.ticketNumber || '');
      let delivered = false;
      if (!hasNotifyFlag(booking, 'confirmedUserNotifiedAt')) {
        if (booking.vkUserId) {
          const ticketLink = buildHuliganMiniAppTicketLink(bookingId);
          const msg = `Теперь ты тоже хулиган, а вот твой билет: ${ticketLink}`;
          const vkResult = await vkSend(booking.vkUserId, msg).catch(() => ({ ok: false }));
          delivered = delivered || !!vkResult?.ok;
        }
        if (booking.tgUserId) {
          const tgResult = await tgSendTicketReady(booking.tgUserId, bookingId).catch(() => ({ ok: false }));
          delivered = delivered || !!tgResult?.ok;
        }
        if (delivered || (!booking.vkUserId && !booking.tgUserId)) {
          await markNotifyFlag(bookingId, booking, 'confirmedUserNotifiedAt');
        }
      }
      return { ok: true, ticketNumber };
    }

    if (curStatus !== 'waiting_admin' && curStatus !== 'waiting_payment' && curStatus !== 'new') {
      return { ok: false, error: `Cannot confirm: status is '${curStatus}'` };
    }

    ticketNumber = String(booking.ticketNumber || '');
    if (!ticketNumber) ticketNumber = genTicketNum();
    const now = Date.now();

    const patch = {
      ...booking,
      status: 'confirmed',
      ticketNumber,
      confirmedAt: now
    };
    if (meta.paidAt) patch.paidAt = Number(meta.paidAt) || now;
    if (meta.transactionId || meta.orderId || meta.provider) {
      // legacy: у старых броней реквизиты лежат в vkPay
      const prev = (booking.payment && typeof booking.payment === 'object' ? booking.payment : null)
        || (booking.vkPay && typeof booking.vkPay === 'object' ? booking.vkPay : {});
      patch.payment = {
        ...prev,
        status: 'paid',
        paidAt: Number(meta.paidAt) || now,
        transactionId: String(meta.transactionId || prev.transactionId || ''),
        orderId: String(meta.orderId || prev.orderId || ''),
        provider: String(meta.provider || 'tbank')
      };
    }

    try {
      const success = await fbConditionalPut(`huligan_bookings/${bookingId}`, patch, etag);
      if (!success) throw new Error('ETAG_MISMATCH');

      const seats = Array.isArray(booking.seats) ? booking.seats : [];
      await Promise.all(seats.map(async s => {
        const seatKey = normalizeHuliganSeatKey(s);
        try {
          const { data: seatCur, etag: seatEtag } = await fbGetWithETag(`huligan_seats/${seatKey}`);
          if (seatCur) {
            await fbConditionalPut(`huligan_seats/${seatKey}`, { ...seatCur, status: 'taken', bookingId }, seatEtag);
          }
        } catch(e) {}
      }));
      
      let delivered = false;
      if (!hasNotifyFlag(patch, 'confirmedUserNotifiedAt')) {
        if (patch.vkUserId) {
          const ticketLink = buildHuliganMiniAppTicketLink(bookingId);
          const msg = `Теперь ты тоже хулиган, а вот твой билет: ${ticketLink}`;
          const vkResult = await vkSend(patch.vkUserId, msg).catch(() => ({ ok: false }));
          delivered = delivered || !!vkResult?.ok;
        }
        if (patch.tgUserId) {
          const tgResult = await tgSendTicketReady(patch.tgUserId, bookingId).catch(() => ({ ok: false }));
          delivered = delivered || !!tgResult?.ok;
        }
        if (delivered || (!patch.vkUserId && !patch.tgUserId)) {
          await markNotifyFlag(bookingId, patch, 'confirmedUserNotifiedAt');
        }
      }

      if (patch.email) {
        try {
          const { token: hulToken } = makeHuliganToken(bookingId, patch.ticketLinkVersion || 1);
          const ticketUrl = `${TICKET_PUBLIC_ORIGIN}/huligan-ticket.html?id=${encodeURIComponent(bookingId)}&tk=${encodeURIComponent(hulToken)}`;
          const html = buildTicketEmailHtml({
            name: patch.name,
            showLabel: 'ХУЛИgan 16+',
            dateLabel: patch.eventDate || '—',
            seatsLabel: TYPE_NAMES[patch.ticketType] || patch.ticketType || '—',
            ticketUrl
          });
          const [eventDatePart, eventTimePart] = String(patch.eventDate || '').split(/\s+(?=\d{1,2}:\d{2}$)/);
          const ticketImage = await renderTicketImage('huligan', {
            name: patch.name,
            dateLabel: eventDatePart || patch.eventDate || '—',
            timeLabel: eventTimePart || '',
            venue: 'Арт-площадка «Лампа»',
            zoneLabel: TYPE_NAMES[patch.ticketType] || patch.ticketType || '—',
            amountLabel: `${Number(patch.finalPrice || 0)} ₽`,
            bookingId,
            ticketUrl
          });
          await sendEmail({
            to: patch.email,
            subject: 'Ваш билет на ХУЛИgan 16+',
            html,
            attachments: ticketImage ? [{ filename: `ticket-${bookingId}.png`, content: ticketImage }] : undefined
          });
        } catch (e) {}
      }

      return { ok: true, ticketNumber };
    } catch (err) {
      if (err.message === 'ETAG_MISMATCH') continue;
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'Concurrent modification' };
}

function canAccessBooking(booking, body = {}, { allowVkUserId = false, allowTgUserId = false } = {}) {
  // Доступ по clientKey (секретный ключ, >= 10 символов) — основной способ.
  // Для legacy-броней без clientKey обязательна привязка к verified TG/VK владельцу.
  const clientKey = String(body.clientKey || '').trim();
  if (booking.clientKey && clientKey && clientKey.length >= 10 && booking.clientKey === clientKey) return true;
  if (allowVkUserId && ALLOW_VK_USERID_FALLBACK && booking.vkUserId) {
    const vk = Number(body.vkUserId);
    if (Number.isFinite(vk) && vk > 0 && vk === Number(booking.vkUserId)) return true;
  }
  if (allowTgUserId && booking.tgUserId) {
    const tg = Number(body._trustedTgUserId || 0);
    if (Number.isFinite(tg) && tg > 0 && tg === Number(booking.tgUserId)) return true;
  }
  return false;
}

function publicBookingView(bookingId, booking, full = false) {
  const base = {
    bookingId,
    ticketType: booking.ticketType || '',
    status: booking.status || '',
    createdAt: booking.createdAt || null,
    ticketNumber: booking.ticketNumber || null,
    finalPrice: Number(booking.finalPrice || 0),
    originalPrice: Number(booking.originalPrice || 0),
    name: booking.name || '',
    reviewed: Boolean(booking.reviewed)
  };
  if (!full) return base;
  return {
    ...base,
    phone: booking.phone || '',
    promoCode: booking.promoCode || null,
    paidAt: booking.paidAt || null,
    confirmedAt: booking.confirmedAt || null
  };
}

import {  setCors  } from '../../shared/cors.js';

export default async (req, res) => {
  setCors(req, res, { methods: 'POST, GET, OPTIONS' });
  await runHuliganAutoCleanup().catch(() => {});

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ──
  if (req.method === 'GET') {
    const getAction = req.query?.action || '';

    // Подписанная ссылка на билет (для QR-кода)
    if (getAction === 'ticket_link') {
      const id = (req.query?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Missing id' });
      try {
        const isAdmin = await isAdminAuthorized(req, {});
        const booking = await fbGet(`huligan_bookings/${id}`);
        if (!booking) return res.status(404).json({ error: 'Ticket not found' });
        if (!isAdmin) {
          const queryBody = {
            clientKey: req.query?.clientKey,
            vkUserId: req.query?.vkUserId,
            _trustedTgUserId: getTrustedTelegramUserId(req.query?.tgInitData)
          };
          if (!canAccessBooking(booking, queryBody, { allowVkUserId: true, allowTgUserId: true })) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        }
        const st = String(booking.status || '').toLowerCase();
        if (BLOCKED_STATUSES.has(st)) return res.status(410).json({ error: 'Ticket revoked' });
        if (st !== 'confirmed') return res.status(409).json({ error: 'Ticket not confirmed yet' });
        const ver = Number(booking.ticketLinkVersion || 1);
        const { token, expiresAt } = makeHuliganToken(id, ver);
        const url = `${TICKET_PUBLIC_ORIGIN}/huligan-ticket.html?id=${encodeURIComponent(id)}&tk=${encodeURIComponent(token)}`;
        const resp = { ok: true, id, url, expiresAt };
        if (req.query?.full === '1') {
          const cfg = await fbGet('huligan_config');
          resp.booking = { name: booking.name || '', ticketType: booking.ticketType || '', ticketNumber: booking.ticketNumber || null, finalPrice: Number(booking.finalPrice || 0), status: booking.status || '', createdAt: booking.createdAt || null, confirmedAt: booking.confirmedAt || null };
          resp.config = cfg?.show || {};
        }
        return res.status(200).json(resp);
      } catch (err) {
        console.error('[huligan ticket_link] error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // Верификация билета по токену (для страницы проверки)
    if (getAction === 'ticket_data') {
      const id = (req.query?.id || '').trim();
      const tk = (req.query?.tk || '').trim();
      if (!id) return res.status(400).json({ error: 'Missing id' });
      try {
        const booking = await fbGet(`huligan_bookings/${id}`);
        if (!booking) return res.status(404).json({ error: 'Ticket not found' });
        const st = String(booking.status || '').toLowerCase();
        if (BLOCKED_STATUSES.has(st)) return res.status(410).json({ error: 'Ticket revoked' });
        if (st !== 'confirmed') return res.status(409).json({ error: 'Ticket not confirmed yet' });
        const check = verifyHuliganToken(tk, id);
        if (!check.ok) return res.status(403).json({ error: 'Invalid or expired ticket link' });
        const curVer = Number(booking.ticketLinkVersion || 1);
        if (check.payload.v && Number(check.payload.v) !== curVer) return res.status(403).json({ error: 'Link invalidated' });
        const cfg = await fbGet('huligan_config');
        return res.status(200).json({ ok: true, bookingId: id, booking: { name: booking.name || '', ticketType: booking.ticketType || '', ticketNumber: booking.ticketNumber || null, finalPrice: Number(booking.finalPrice || 0), status: booking.status || '', createdAt: booking.createdAt || null, confirmedAt: booking.confirmedAt || null }, config: cfg?.show || {} });
      } catch (err) {
        console.error('[huligan ticket_data] error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // Публичные отзывы (для отображения на странице)
    if (getAction === 'reviews') {
      const reviews = await fbGet('huligan_reviews') || {};
      const items = Object.values(reviews)
        .filter(r => r && r.text && r.rating)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20)
        .map(r => ({ rating: r.rating, text: r.text, name: r.name || 'Гость', createdAt: r.createdAt || null, vkUserId: r.vkUserId || null }));
      return res.status(200).json(items);
    }

    // Список всех бронирований (для админ-панели)
    if (!(await isAdminAuthorized(req, {}))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const bookings = await fbGet('huligan_bookings');
    return res.status(200).json(bookings || {});
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = parseIncomingBody(req.body);
  if (body && typeof body === 'object' && typeof body.body === 'string' && !body.action && !body.data && !body.signature) {
    // На части платформ вебхуки приходят как { body: "data=...&signature=..." }.
    const nested = parseIncomingBody(body.body);
    if (nested && Object.keys(nested).length) body = nested;
  }
  if (body && typeof body === 'object') {
    body._trustedTgUserId = getTrustedTelegramUserId(body.tgInitData);
  }

  const action = String(body?.action || req.query?.action || '').trim();
  const bookingId = String(body?.bookingId || req.query?.bookingId || '').trim();
  if (!action) return res.status(400).json({ error: 'Missing action' });

  try {
    // ── Public config for mini-app ──
    if (action === 'get_config') {
      const cfg = await fbGet('huligan_config');
      const publicCfg = cfg && typeof cfg === 'object' ? { ...cfg } : {};
      publicCfg.metrics = {
        yandexCounterId: String(process.env.YM_HULIGAN_COUNTER_ID || '').trim()
      };
      const tbankEnabledForThisClient = isTBankEnabledForRequest(body, { forWebhook: false });
      publicCfg.tbank = {
        enabled: Boolean(tbankEnabledForThisClient),
        testMode: Boolean(getTBankCredentials().testMode),
        provider: 'tbank',
        testOnly: Boolean(tbankEnabledForThisClient && !isTruthyFlag(TBANK_HULIGAN_ENABLED_RAW)),
        canIssueWithoutPayment: Boolean(canUseTBankTestTools(body))
      };
      return res.status(200).json(publicCfg);
    }

    // ── Get one booking by ID (for polling / resume) ──
    if (action === 'get_booking') {
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const isAdmin = await isAdminAuthorized(req, body);
      if (!isAdmin && !canAccessBooking(booking, body, { allowVkUserId: true, allowTgUserId: true })) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(200).json(publicBookingView(bookingId, booking, true));
    }

    // ── List bookings for user (VK/TG) (for "Мои билеты") ──
    if (action === 'list_user_bookings') {
      const vkUserId = Number(body?.vkUserId);
      const tgUserId = Number(body?._trustedTgUserId || 0);
      const hasVk = ALLOW_VK_USERID_FALLBACK && Number.isFinite(vkUserId) && vkUserId > 0;
      const hasTg = Number.isFinite(tgUserId) && tgUserId > 0;
      if (!hasVk && !hasTg) return res.status(200).json([]);
      const all = await fbGet('huligan_bookings') || {};
      const items = Object.entries(all)
        .map(([id, b]) => ({ bookingId: b.bookingId || id, ...b }))
        .filter(b => (hasVk && Number(b.vkUserId) === vkUserId) || (hasTg && Number(b.tgUserId) === tgUserId))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res.status(200).json(items.map(b => publicBookingView(b.bookingId || b.id, b, false)));
    }

    // ── Get one promo by code ──
    if (action === 'get_promo') {
      const code = String(body?.code || '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'Missing code' });
      const promo = await fbGet(`huligan_promo/${code}`);
      if (!promo) return res.status(200).json(null);
      const nowTs = Date.now();
      const notExpired = !promo?.expiresAt || nowTs <= Number(promo.expiresAt);
      const notTooEarly = !promo?.validFrom || nowTs >= Number(promo.validFrom);
      const notPastValidUntil = !promo?.validUntil || nowTs <= Number(promo.validUntil);
      const hasUses = promo?.usesLeft == null || Number(promo.usesLeft) === -1 || Number(promo.usesLeft) > 0;
      const activeNow = !!promo.active && notExpired && notTooEarly && notPastValidUntil && hasUses;
      return res.status(200).json({
        active: !!promo.active,
        activeNow,
        type: promo.type || null,
        value: Number(promo.value || 0),
        usesLeft: promo.usesLeft ?? null,
        expiresAt: promo.expiresAt || null,
        validFrom: promo.validFrom || null,
        validUntil: promo.validUntil || null,
        description: promo.description || null
      });
    }

    // ── Prepare T-Bank payment link ──
    if (action === 'tbank_init') {
      if (await isHuliganSalesPaused()) {
        return res.status(409).json({ error: 'Продажи на ХУЛИgan временно остановлены' });
      }
      if (!isTBankEnabledForRequest(body, { forWebhook: false })) {
        return res.status(409).json({ error: 'T-Bank is not configured' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const isAdmin = await isAdminAuthorized(req, body);
      if (!isAdmin && !canAccessBooking(booking, body, { allowVkUserId: true, allowTgUserId: true })) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const status = String(booking.status || '').toLowerCase();
      if (BLOCKED_STATUSES.has(status)) return res.status(409).json({ error: 'Booking already closed' });
      if (status === 'confirmed') return res.status(200).json({ ok: true, alreadyConfirmed: true });
      if (status !== 'new' && status !== 'waiting_payment' && status !== 'waiting_admin') {
        return res.status(409).json({ error: `Cannot pay in status '${status}'` });
      }

      const amountRub = Number(booking.finalPrice || 0);
      if (!Number.isFinite(amountRub) || amountRub <= 0) {
        const freeConfirm = await confirmBookingAndNotify(bookingId, booking, {
          provider: 'tbank',
          paidAt: Date.now()
        });
        if (!freeConfirm.ok) {
          return res.status(500).json({ error: freeConfirm.error || 'Failed to confirm booking' });
        }
        return res.status(200).json({ ok: true, alreadyConfirmed: true, freeTicket: true });
      }

      const amountKopek = Math.round(amountRub * 100);
      const creds = getTBankCredentials();
      if (!creds.terminalKey || !creds.password) {
        return res.status(409).json({ error: 'T-Bank credentials are missing' });
      }

      const orderId = String(booking?.tbank?.orderId || bookingId);
      const initPayload = {
        Amount: amountKopek,
        OrderId: orderId,
        Description: `Билет ${TYPE_NAMES[booking.ticketType] || booking.ticketType || 'ХУЛИgan'} — ХУЛИgan 16+`,
        NotificationURL: TBANK_NOTIFY_URL,
        SuccessURL: TBANK_SUCCESS_URL,
        FailURL: TBANK_FAIL_URL
      };

      const initResult = await tbankApi('Init', initPayload, creds);
      if (!initResult.httpOk || !initResult.data?.Success) {
        const msg = String(
          initResult?.data?.Message
          || initResult?.data?.Details
          || initResult?.data?.ErrorCode
          || 'T-Bank Init failed'
        );
        return res.status(502).json({ error: msg });
      }

      const paymentId = String(initResult.data.PaymentId || '');
      const paymentUrl = String(initResult.data.PaymentURL || '');
      const paymentStatus = String(initResult.data.Status || 'NEW').toUpperCase();

      await fbPatch(`huligan_bookings/${bookingId}`, {
        status: 'waiting_payment',
        tbank: {
          provider: 'tbank',
          testMode: Boolean(creds.testMode),
          orderId,
          paymentId,
          amountKopek,
          status: paymentStatus,
          paymentURL: paymentUrl,
          initedAt: Date.now()
        }
      });

      return res.status(200).json({
        ok: true,
        provider: 'tbank',
        testMode: Boolean(creds.testMode),
        orderId,
        paymentId,
        paymentUrl,
        status: paymentStatus
      });
    }

    // ── T-Bank webhook notification ──
    if (action === 'tbank_notify') {
      const sendText = (code, text) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(code).send(String(text || ''));
      };
      if (!isTBankEnabledForRequest(body, { forWebhook: true })) {
        return sendText(503, 'DISABLED');
      }
      const creds = getTBankCredentials();
      if (!creds.terminalKey || !creds.password) {
        return sendText(503, 'NOT_CONFIGURED');
      }

      const payload = body && typeof body === 'object' ? body : {};
      const terminalKey = String(payload.TerminalKey || '').trim();
      const orderIdRaw = String(payload.OrderId || '').trim();
      const paymentId = String(payload.PaymentId || '').trim();
      const statusRaw = String(payload.Status || '').toUpperCase();
      const successFlag = payload.Success;
      const amountKopek = Number(payload.Amount || 0);

      if (!orderIdRaw) return sendText(400, 'BAD_ORDER');
      if (terminalKey && terminalKey !== creds.terminalKey) {
        return sendText(403, 'BAD_TERMINAL');
      }
      if (!verifyTBankToken(payload, creds.password)) {
        return sendText(403, 'BAD_TOKEN');
      }

      let found = await fbGet(`huligan_bookings/${orderIdRaw}`);
      let resolvedBookingId = orderIdRaw;
      if (!found) {
        const byOrder = await findBookingByTBankOrderId(orderIdRaw);
        if (byOrder) {
          resolvedBookingId = byOrder.bookingId;
          found = byOrder.booking;
        }
      }
      if (!found) {
        // Возвращаем OK, чтобы банк не засыпал ретраями на несуществующий заказ.
        return sendText(200, 'OK');
      }

      const booking = found;
      const currentStatus = String(booking.status || '').toLowerCase();
      if (!BLOCKED_STATUSES.has(currentStatus)) {
        const patch = {
          tbank: {
            ...(booking.tbank && typeof booking.tbank === 'object' ? booking.tbank : {}),
            provider: 'tbank',
            testMode: Boolean(creds.testMode),
            orderId: orderIdRaw,
            paymentId: paymentId || String(booking?.tbank?.paymentId || ''),
            amountKopek: Number.isFinite(amountKopek) && amountKopek > 0 ? amountKopek : Number(booking?.tbank?.amountKopek || 0),
            status: statusRaw || String(booking?.tbank?.status || ''),
            notifiedAt: Date.now(),
            success: successFlag === true || String(successFlag).toLowerCase() === 'true'
          }
        };
        await fbPatch(`huligan_bookings/${resolvedBookingId}`, patch);
        booking.tbank = patch.tbank;
      }

      if (Number.isFinite(amountKopek) && amountKopek > 0) {
        const expected = Math.round(Number(booking.finalPrice || 0) * 100);
        if (expected > 0 && expected !== amountKopek) {
          return sendText(400, 'BAD_AMOUNT');
        }
      }

      const isPaid = statusRaw === 'CONFIRMED'
        || statusRaw === 'AUTHORIZED'
        || (String(successFlag).toLowerCase() === 'true' && statusRaw === 'CONFIRMED');
      const isDeclined = statusRaw === 'REJECTED'
        || statusRaw === 'CANCELED'
        || statusRaw === 'DEADLINE_EXPIRED'
        || statusRaw === 'AUTH_FAIL';

      if (isPaid) {
        const result = await confirmBookingAndNotify(resolvedBookingId, booking, {
          provider: 'tbank',
          orderId: orderIdRaw,
          transactionId: paymentId,
          paidAt: Date.now()
        });
        if (!result.ok) {
          return sendText(500, 'FAIL_CONFIRM');
        }
      } else if (isDeclined) {
        const bookingState = String(booking.status || '').toLowerCase();
        if (bookingState !== 'confirmed') {
          await fbPatch(`huligan_bookings/${resolvedBookingId}`, { status: 'new' });
        }
      }

      return sendText(200, 'OK');
    }

    // ── T-Bank status pull fallback (if webhook delayed) ──
    if (action === 'tbank_check') {
      if (!isTBankEnabledForRequest(body, { forWebhook: false })) {
        return res.status(409).json({ error: 'T-Bank is not configured' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const isAdmin = await isAdminAuthorized(req, body);
      if (!isAdmin && !canAccessBooking(booking, body, { allowVkUserId: true, allowTgUserId: true })) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const st = String(booking.status || '').toLowerCase();
      if (st === 'confirmed') return res.status(200).json({ ok: true, confirmed: true, status: 'CONFIRMED' });

      const creds = getTBankCredentials();
      const paymentId = String(body?.paymentId || booking?.tbank?.paymentId || '').trim();
      if (!paymentId) return res.status(200).json({ ok: true, confirmed: false, status: booking?.tbank?.status || null });

      const stateResult = await tbankApi('GetState', { PaymentId: paymentId }, creds);
      const state = stateResult?.data || {};
      const paymentStatus = String(state.Status || '').toUpperCase();

      if (!stateResult.httpOk || !state.Success) {
        return res.status(200).json({ ok: true, confirmed: false, status: paymentStatus || null });
      }

      if (paymentStatus === 'CONFIRMED' || paymentStatus === 'AUTHORIZED') {
        const result = await confirmBookingAndNotify(bookingId, booking, {
          provider: 'tbank',
          orderId: String(booking?.tbank?.orderId || bookingId),
          transactionId: paymentId,
          paidAt: Date.now()
        });
        if (!result.ok) return res.status(409).json({ error: result.error || 'Cannot confirm booking' });
        return res.status(200).json({ ok: true, confirmed: true, status: paymentStatus });
      }

      if (paymentStatus === 'REJECTED' || paymentStatus === 'CANCELED' || paymentStatus === 'DEADLINE_EXPIRED' || paymentStatus === 'AUTH_FAIL') {
        if (st !== 'confirmed') await fbPatch(`huligan_bookings/${bookingId}`, { status: 'new' });
      }

      return res.status(200).json({ ok: true, confirmed: false, status: paymentStatus || null });
    }

    // ── T-Bank test tool: issue ticket without payment (admin only) ──
    if (action === 'tbank_test_issue_ticket') {
      if (!canUseTBankTestTools(body)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });

      const st = String(booking.status || '').toLowerCase();
      if (BLOCKED_STATUSES.has(st)) return res.status(409).json({ error: 'Booking already closed' });

      const result = await confirmBookingAndNotify(bookingId, booking, {
        provider: 'tbank_test_manual',
        orderId: String(booking?.tbank?.orderId || bookingId),
        transactionId: String(booking?.tbank?.paymentId || `TEST-${Date.now()}`),
        paidAt: Date.now()
      });
      if (!result.ok) return res.status(409).json({ error: result.error || 'Cannot confirm booking' });
      return res.status(200).json({ ok: true, ticketNumber: result.ticketNumber || booking.ticketNumber || '' });
    }

    // ── Lead request (VK moderation-safe flow without transfer payment) ──
    if (action === 'lead_request') {
      if (await isHuliganSalesPaused()) {
        return res.status(409).json({ error: 'Продажи на ХУЛИgan временно остановлены' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });

      const isAdmin = await isAdminAuthorized(req, body);
      if (!isAdmin && !canAccessBooking(booking, body, { allowVkUserId: true, allowTgUserId: true })) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const status = String(booking.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'refunded' || status === 'returned') {
        return res.status(409).json({ error: 'Booking already closed' });
      }
      if (status === 'confirmed') {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      if (hasNotifyFlag(booking, 'leadRequestedAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }

      const vkLink = booking.vkUserId ? `vk.com/id${booking.vkUserId}` : '—';
      const tgLink = booking.tgUserId
        ? `tg://user?id=${booking.tgUserId}`
        : (booking.tgUsername ? `https://t.me/${String(booking.tgUsername).replace(/^@/, '')}` : '—');

      const msg = [
        '📩 Новая заявка из VK Mini App — ХУЛИgan',
        '',
        `Имя: ${booking.name || '—'}`,
        `Телефон: ${booking.phone || '—'}`,
        `Тип билета: ${TYPE_NAMES[booking.ticketType] || booking.ticketType || '—'}`,
        `Сумма: ${Number(booking.finalPrice || 0)} ₽`,
        `🆔 Бронь: ${bookingId}`,
        `👤 VK: ${vkLink}`,
        `💬 TG: ${tgLink}`,
        '',
        'Свяжитесь с клиентом в личных сообщениях.'
      ].join('\n');

      await saveAdminNotification(msg, 'huligan_lead_request', bookingId);
      await notifyAdmin(msg).catch(() => { });
      await fbPatch(`huligan_bookings/${bookingId}`, {
        leadRequestedAt: Date.now(),
        leadRequestedFrom: 'miniapp'
      });
      await markNotifyFlag(bookingId, booking, 'leadRequestedAdminNotifiedAt');
      return res.status(200).json({ ok: true });
    }

    // ── Notify admin about new payment ──
    if (action === 'notify_admin') {
      if (await isHuliganSalesPaused()) {
        return res.status(409).json({ error: 'Продажи на ХУЛИgan временно остановлены' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const isAdmin = await isAdminAuthorized(req, body);
      if (!isAdmin && !canAccessBooking(booking, body)) return res.status(403).json({ error: 'Forbidden' });

      // Принимаем уведомление только от брони в статусе new или waiting_admin
      const currentStatus = String(booking.status || '');
      if (currentStatus !== 'new' && currentStatus !== 'waiting_admin') {
        return res.status(409).json({ error: 'Booking is not awaiting payment' });
      }
      if (currentStatus === 'waiting_admin' && hasNotifyFlag(booking, 'paymentAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }

      // Сервер переводит статус — клиент не пишет в Firebase напрямую
      if (currentStatus === 'new') {
        const patch = {
          status: 'waiting_admin',
          paidAt: Date.now()
        };
        const incomingVkId = Number(body.vkUserId || 0);
        if (ALLOW_VK_USERID_FALLBACK && !booking.vkUserId && Number.isFinite(incomingVkId) && incomingVkId > 0) {
          patch.vkUserId = incomingVkId;
        }
        if (!booking.tgUserId && Number.isFinite(Number(body?._trustedTgUserId)) && Number(body._trustedTgUserId) > 0) {
          patch.tgUserId = Number(body._trustedTgUserId);
        }
        await fbPatch(`huligan_bookings/${bookingId}`, patch);
        booking.status = patch.status;
        booking.paidAt = patch.paidAt;
        if (patch.vkUserId) booking.vkUserId = patch.vkUserId;
        if (patch.tgUserId) booking.tgUserId = patch.tgUserId;
      }

      const vkLink = booking.vkUserId ? `\n👤 VK: vk.com/id${booking.vkUserId}` : '';
      const tgRef = booking.tgUserId
        ? `tg://user?id=${booking.tgUserId}`
        : (booking.tgUsername ? `https://t.me/${String(booking.tgUsername).replace(/^@/, '')}` : '');
      const tgLink = tgRef ? `\n💬 TG: ${tgRef}` : '';
      const msg = [
        '😈 Новый заказ ХУЛИgan 18+',
        '',
        `Имя: ${booking.name}`,
        `Тип: ${TYPE_NAMES[booking.ticketType] || booking.ticketType}`,
        `🆔 ${bookingId}`,
        vkLink,
        tgLink,
        '',
        '✅ Подтвердить оплату:',
        ADMIN_PANEL_URL
      ].filter(l => l !== null).join('\n');

      const result = await notifyAdmin(msg);
      await markNotifyFlag(bookingId, booking, 'paymentAdminNotifiedAt');
      console.log('[huligan] notify_admin result:', JSON.stringify(result));
      return res.status(200).json({ ok: true });
    }

    // ── Confirm payment (called from admin panel) ──
    if (action === 'confirm') {
      if (!(await isAdminAuthorized(req, body))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const curStatus = String(booking.status || '').toLowerCase();
      // legacy: у броней, созданных до отказа от VK Pay, реквизиты лежат в vkPay
      const prevPayment = booking?.payment || booking?.vkPay || {};
      const result = await confirmBookingAndNotify(bookingId, booking, {
        provider: String(prevPayment.provider || 'manual'),
        orderId: String(prevPayment.orderId || ''),
        transactionId: String(prevPayment.transactionId || ''),
        paidAt: Number(booking?.paidAt || Date.now())
      });
      if (!result.ok) return res.status(409).json({ error: result.error || 'Cannot confirm booking' });
      return res.status(200).json({
        ok: true,
        ticketNumber: result.ticketNumber || booking.ticketNumber || '',
        idempotent: curStatus === 'confirmed'
      });
    }

    // ── Cancel order ──
    if (action === 'cancel') {
      if (!(await isAdminAuthorized(req, body))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const status = String(booking.status || '').toLowerCase();
      if (status === 'refunded' || status === 'returned') {
        return res.status(409).json({ error: `Cannot cancel: status is '${status}'` });
      }
      if (status === 'cancelled' && hasNotifyFlag(booking, 'cancelledUserNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      if (status !== 'cancelled') {
        await fbPatch(`huligan_bookings/${bookingId}`, { status: 'cancelled', cancelledAt: Date.now() });
        const seats = Array.isArray(booking.seats) ? booking.seats : [];
        await Promise.all(seats.map(s => {
          const seatKey = normalizeHuliganSeatKey(s);
          return fbPut(`huligan_seats/${seatKey}`, { status: 'available' }).catch(() => {});
        })).catch(() => {});
      }

      let delivered = false;
      if (booking.vkUserId) {
        const msg = [
          '↩ Возврат/отмена оформлены',
          '',
          'Ваш билет на «ХУЛИgan» переведён в статус отмены.',
          'Если был согласован возврат, деньги будут отправлены по вашему запросу.',
          '',
          `🆔 Бронь: ${bookingId}`
        ].join('\n');
        const vkResult = await vkSend(booking.vkUserId, msg).catch(() => ({ ok: false }));
        delivered = delivered || !!vkResult?.ok;
      }
      if (booking.tgUserId) {
        const msg = [
          '↩ Возврат/отмена оформлены',
          '',
          'Ваш билет на «ХУЛИgan» переведён в статус отмены.',
          'Если был согласован возврат, деньги будут отправлены по вашему запросу.',
          '',
          `🆔 Бронь: ${bookingId}`
        ].join('\n');
        const tgResult = await tgSend(booking.tgUserId, msg).catch(() => ({ ok: false }));
        delivered = delivered || !!tgResult?.ok;
      }
      if (delivered || (!booking.vkUserId && !booking.tgUserId)) {
        await markNotifyFlag(bookingId, booking, 'cancelledUserNotifiedAt');
      }
      return res.status(200).json({ ok: true });
    }

    // ── Refund confirmed order (admin) ──
    if (action === 'refund') {
      if (!(await isAdminAuthorized(req, body))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });

      const status = String(booking.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'returned') {
        return res.status(409).json({ error: 'Booking already closed' });
      }
      if (status === 'refunded' && hasNotifyFlag(booking, 'refundedUserNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }

      const reason = String(body?.reason || '').trim();
      if (status !== 'refunded') {
        // Реальный возврат денег через T-Bank (Cancel по PaymentId).
        // Если платежа не было — просто аннулируем билет/освобождаем место.
        let refundInfo = { attempted: false };
        const paymentId = String(booking?.tbank?.paymentId || '');
        if (paymentId) {
          const creds = getTBankCredentials();
          if (creds.terminalKey && creds.password) {
            // Узнаём текущий статус платежа в банке (для диагностики и выбора действия)
            const stateRes = await tbankApi('GetState', { PaymentId: paymentId }, creds);
            const bankState = String(stateRes.data?.Status || '').toUpperCase();

            const cancelRes = await tbankApi('Cancel', { PaymentId: paymentId }, creds);
            refundInfo = {
              attempted: true,
              ok: Boolean(cancelRes.httpOk && cancelRes.data?.Success),
              message: cancelRes.data?.Message || null,
              details: cancelRes.data?.Details || null,
              errorCode: cancelRes.data?.ErrorCode || null,
              tbankStatus: cancelRes.data?.Status || null,
              stateBefore: bankState || null
            };
            if (!refundInfo.ok) {
              // Идемпотентно: если платёж УЖЕ отменён/возвращён в банке — считаем успехом
              const alreadyBack = ['CANCELED', 'CANCELLED', 'REFUNDED', 'REVERSED', 'PARTIAL_REFUNDED'].includes(bankState);
              if (!alreadyBack) {
                return res.status(502).json({ error: 'T-Bank refund failed', detail: refundInfo });
              }
              refundInfo.ok = true;
              refundInfo.idempotentBankState = bankState;
            }
          }
        }
        await fbPatch(`huligan_bookings/${bookingId}`, {
          status: 'refunded',
          refundedAt: Date.now(),
          refundReason: reason || null,
          ticketLinkVersion: Number(booking.ticketLinkVersion || 1) + 1,
          tbankRefund: refundInfo
        });
        const seats = Array.isArray(booking.seats) ? booking.seats : [];
        await Promise.all(seats.map(s => {
          const seatKey = normalizeHuliganSeatKey(s);
          return fbPut(`huligan_seats/${seatKey}`, { status: 'available' }).catch(() => {});
        })).catch(() => {});
      }

      let delivered = false;
      if (booking.vkUserId) {
        const msg = [
          '↩ Возврат оформлен',
          '',
          'Ваш билет на «ХУЛИgan» аннулирован.',
          'Деньги будут возвращены по вашему запросу.',
          'Спасибо, что обратились к нам.',
          '',
          'Если удобно, напишите в ответ, почему вы решили вернуть билет.',
          '',
          `🆔 Бронь: ${bookingId}`
        ].join('\n');
        const vkResult = await vkSend(booking.vkUserId, msg).catch(() => ({ ok: false }));
        delivered = delivered || !!vkResult?.ok;
      }
      if (booking.tgUserId) {
        const msg = [
          '↩ Возврат оформлен',
          '',
          'Ваш билет на «ХУЛИgan» аннулирован.',
          'Деньги будут возвращены по вашему запросу.',
          'Спасибо, что обратились к нам.',
          '',
          'Если удобно, напишите в ответ, почему вы решили вернуть билет.',
          '',
          `🆔 Бронь: ${bookingId}`
        ].join('\n');
        const tgResult = await tgSend(booking.tgUserId, msg).catch(() => ({ ok: false }));
        delivered = delivered || !!tgResult?.ok;
      }
      if (delivered || (!booking.vkUserId && !booking.tgUserId)) {
        await markNotifyFlag(bookingId, booking, 'refundedUserNotifiedAt');
      }

      return res.status(200).json({ ok: true });
    }

    // ── Direct Firebase write from browser (fb_put, fb_patch) ──
    if (action === 'fb_put') {
      if (await isHuliganSalesPaused()) {
        return res.status(409).json({ error: 'Продажи на ХУЛИgan временно остановлены' });
      }
      let { path, data } = body;
      if (Number.isFinite(Number(body?._trustedTgUserId)) && Number(body._trustedTgUserId) > 0) {
        data = { ...data, tgUserId: Number(body._trustedTgUserId) };
      }
      if (!ALLOW_VK_USERID_FALLBACK && data && Object.prototype.hasOwnProperty.call(data, 'vkUserId')) {
        data = { ...data, vkUserId: null };
      }
      if (!path) return res.status(400).json({ error: 'Missing path' });
      if (!validateBookingCreate(path, data)) {
        return res.status(400).json({ error: 'Invalid booking payload' });
      }
      // Защита от дублей: если бронь с таким ID уже существует — отклоняем
      const bookingIdNew = path.split('/')[1];
      const existing = await fbGet(`huligan_bookings/${bookingIdNew}`);
      if (existing) return res.status(409).json({ error: 'Booking ID already exists' });

      // --- СЕРВЕРНАЯ ПРОВЕРКА И АТОМАРНОЕ РЕЗЕРВИРОВАНИЕ МЕСТ ---
      const seats = Array.isArray(data.seats) ? data.seats : [];
      const tempBookingId = String(body.tempBookingId || data.tempBookingId || '').trim();
      const RESERVE_MS = 10 * 60 * 1000; // 10 минут
      const now = Date.now();
      const takenSeats = [];

      for (const s of seats) {
        const seatKey = normalizeHuliganSeatKey(s);
        const seatData = await fbGet(`huligan_seats/${seatKey}`);
        if (!seatData) continue;

        const status = String(seatData.status || '');
        const seatBookingId = String(seatData.bookingId || '');

        if (status === 'taken') {
          takenSeats.push(seatKey);
        } else if (status === 'reserved' && seatBookingId !== tempBookingId) {
          const reservedAt = Number(seatData.reservedAt || seatData.at || 0);
          if (now - reservedAt < RESERVE_MS) {
            takenSeats.push(seatKey);
          }
        }
      }

      if (takenSeats.length > 0) {
        return res.status(409).json({ error: 'Seats already taken', seats: takenSeats });
      }

      // Проверяем цены на сервере — клиент не должен сам устанавливать стоимость
      const cfg = await fbGet('huligan_config');
      const prices = cfg?.prices || { vip: 1700, std: 1400, eco: 1100 };
      let expectedPrice = 0;
      if (seats.length > 0) {
        for (const s of seats) {
          const zone = String(s.zone || 'std').toLowerCase();
          const zoneKey = zone === 'standard' || zone === 'standart' || zone === 'std' ? 'std' : (zone === 'econom' || zone === 'eco' ? 'eco' : zone);
          expectedPrice += Number(prices[zoneKey] || prices.std || 1400);
        }
      } else {
        const typeKey = String(data.ticketType);
        if (cfg?.ticketTypes?.[typeKey]?.price != null) {
          expectedPrice = Number(cfg.ticketTypes[typeKey].price);
        } else if (prices[typeKey] != null) {
          expectedPrice = Number(prices[typeKey]);
        }
      }
      if (expectedPrice > 0 && Number(data.originalPrice) !== expectedPrice) {
        return res.status(400).json({ error: 'Price mismatch' });
      }

      // Валидация и применение промокода на сервере
      let serverFinalPrice = expectedPrice > 0 ? expectedPrice : Number(data.originalPrice);
      let promoApplied = null;
      if (data.promoCode) {
        const pCode = String(data.promoCode).trim().toUpperCase();
        const promo = await fbGet(`huligan_promo/${pCode}`);
        const nowTs = Date.now();
        const notExpired = !promo?.expiresAt || nowTs <= Number(promo.expiresAt);
        const notTooEarly = !promo?.validFrom || nowTs >= Number(promo.validFrom);
        const notPastValidUntil = !promo?.validUntil || nowTs <= Number(promo.validUntil);
        const hasUses = promo?.usesLeft == null || promo.usesLeft === -1 || promo.usesLeft > 0;
        if (promo && promo.active === true && notExpired && notTooEarly && notPastValidUntil && hasUses) {
          if (promo.type === 'free') serverFinalPrice = 0;
          else if (promo.type === 'percent') serverFinalPrice = Math.round(serverFinalPrice * (1 - promo.value / 100));
          else if (promo.type === 'fixed') serverFinalPrice = Math.max(0, serverFinalPrice - promo.value);
          promoApplied = { code: pCode, usesLeft: promo.usesLeft };
        } else {
          // Промокод недействителен — игнорируем, берём полную цену
          data = { ...data, promoCode: null };
        }
      }
      // Принудительно устанавливаем finalPrice — клиенту не доверяем
      data = { ...data, finalPrice: serverFinalPrice };

      try {
        await fbPut(path, data);

        // Резервируем места
        await Promise.all(seats.map(s => {
          const seatKey = normalizeHuliganSeatKey(s);
          return fbPut(`huligan_seats/${seatKey}`, {
            status: 'reserved',
            bookingId: bookingIdNew,
            reservedAt: now
          });
        }));
      } catch (err) {
        // Откат при сбое записи брони
        await Promise.all(seats.map(s => {
          const seatKey = normalizeHuliganSeatKey(s);
          return fbPatch(`huligan_seats/${seatKey}`, { bookingId: tempBookingId || null, status: tempBookingId ? 'reserved' : null }).catch(() => {});
        })).catch(() => {});
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Списываем промокод
      if (promoApplied && promoApplied.usesLeft !== -1) {
        const { data: p2, etag: pe } = await fbGetWithETag(`huligan_promo/${promoApplied.code}`);
        if (p2 && p2.usesLeft > 0 && pe) {
          await fbConditionalPut(`huligan_promo/${promoApplied.code}`, { ...p2, usesLeft: p2.usesLeft - 1 }, pe);
        }
      }

      // Уведомление админу о новой заявке до нажатия "Я оплатил".
      try {
        const tgRef = data.tgUserId
          ? `tg://user?id=${data.tgUserId}`
          : (data.tgUsername ? `https://t.me/${String(data.tgUsername).replace(/^@/, '')}` : '—');
        const vkRef = data.vkUserId ? `vk.com/id${data.vkUserId}` : '—';
        const msg = [
          '🆕 Новая бронь создана — ХУЛИgan',
          '',
          `Имя: ${data.name || '—'}`,
          `Тип билета: ${TYPE_NAMES[data.ticketType] || data.ticketType || '—'}`,
          `Сумма: ${Number(data.finalPrice || 0)} ₽`,
          `🆔 Бронь: ${bookingIdNew}`,
          `👤 VK: ${vkRef}`,
          `💬 TG: ${tgRef}`,
          '',
          '⏳ Ожидает оплату (автоотмена через 10 минут).',
          `🔧 Админка: ${ADMIN_PANEL_URL}`
        ].join('\n');
        await saveAdminNotification(msg, 'huligan_booking_created', bookingIdNew);
        await notifyAdmin(msg).catch(() => {});
      } catch {}

      return res.status(200).json({ ok: true });
    }

    if (action === 'fb_patch') {
      const { path, data } = body;
      if (!path) return res.status(400).json({ error: 'Missing path' });
      if (!validateBookingPatch(path, data)) {
        return res.status(400).json({ error: 'Invalid patch payload' });
      }
      const id = path.split('/')[1];
      const booking = await fbGet(`huligan_bookings/${id}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const isAdmin = await isAdminAuthorized(req, body);
      const accessPayload = { clientKey: data.clientKey, vkUserId: data.vkUserId, _trustedTgUserId: body?._trustedTgUserId };
      if (!isAdmin && !canAccessBooking(booking, accessPayload, { allowVkUserId: true, allowTgUserId: true })) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await fbPatch(path, { status: data.status, paidAt: data.paidAt });
      return res.status(200).json({ ok: true });
    }

    // ── Refund request ──
    if (action === 'refund_request') {
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const isAdmin = await isAdminAuthorized(req, body);
      if (!isAdmin && !canAccessBooking(booking, body, { allowVkUserId: true, allowTgUserId: true })) return res.status(403).json({ error: 'Forbidden' });
      const status = String(booking.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'refunded' || status === 'returned') {
        return res.status(409).json({ error: 'Booking already closed' });
      }
      if (status === 'refund_requested' && hasNotifyFlag(booking, 'refundRequestedAdminNotifiedAt')) {
        return res.status(200).json({ ok: true, idempotent: true });
      }
      const reason = String(body?.reason || '').trim();
      if (status !== 'refund_requested') {
        const patch = {
          refundRequested: true,
          refundRequestedAt: Date.now(),
          status: 'refund_requested'
        };
        if (reason) patch.refundReason = reason;
        await fbPatch(`huligan_bookings/${bookingId}`, patch);
      }

      const vkLink = booking.vkUserId ? `vk.com/id${booking.vkUserId}` : '—';
      const tgLink = booking.tgUserId
        ? `tg://user?id=${booking.tgUserId}`
        : (booking.tgUsername ? `https://t.me/${String(booking.tgUsername).replace(/^@/, '')}` : '—');
      const msg = [
        '↩ ЗАПРОС НА ВОЗВРАТ — ХУЛИgan',
        '',
        `Имя: ${booking.name}`,
        `Тип билета: ${TYPE_NAMES[booking.ticketType] || booking.ticketType}`,
        `🆔 Бронь: ${bookingId}`,
        `👤 VK: ${vkLink}`,
        `💬 TG: ${tgLink}`,
        reason ? `💬 Причина: ${reason}` : '💬 Причина: не указана',
        '',
        '⚠️ Нужно вернуть деньги. Свяжитесь с клиентом!'
      ].join('\n');

      await notifyAdmin(msg);
      await markNotifyFlag(bookingId, booking, 'refundRequestedAdminNotifiedAt');
      return res.status(200).json({ ok: true });
    }

    // ── Review ──
    if (action === 'review') {
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
      const booking = await fbGet(`huligan_bookings/${bookingId}`);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      if (!canAccessBooking(booking, body, { allowVkUserId: true, allowTgUserId: true })) return res.status(403).json({ error: 'Forbidden' });
      if (booking.status !== 'confirmed') return res.status(409).json({ error: 'Can only review confirmed bookings' });
      if (booking.reviewed) return res.status(409).json({ error: 'Already reviewed' });

      const rating = Math.min(5, Math.max(1, Number(body.rating) || 5));
      const text = String(body.reviewText || '').trim();
      if (!text) return res.status(400).json({ error: 'Review text required' });

      // Генерируем промокод за отзыв (срок — 2 месяца)
      const promoCode = `HUL${randomFromAlphabet(5, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')}`;

      const now = Date.now();
      const TWO_MONTHS_MS = 60 * 24 * 3600000; // ~60 дней
      const expiresAt = now + TWO_MONTHS_MS;
      const expiresDate = new Date(expiresAt).toLocaleDateString('ru-RU');

      const reviewId = `R-${bookingId}-${now}`;
      await fbPut(`huligan_reviews/${reviewId}`, {
        bookingId, rating, text, promoCode, createdAt: now,
        name: booking.name || '', vkUserId: booking.vkUserId || null, tgUserId: booking.tgUserId || null
      });
      await fbPut(`huligan_promo/${promoCode}`, {
        type: 'fixed', value: 200, usesLeft: 1,
        active: true, description: 'Бонус за отзыв — скидка 200 ₽',
        createdAt: now, expiresAt,
        vkUserId: booking.vkUserId || null,
        tgUserId: booking.tgUserId || null,
        bookingId
      });
      await fbPatch(`huligan_bookings/${bookingId}`, { reviewed: true, reviewPromoCode: promoCode });

      // Уведомляем админа
      const adminMsg = [
        `⭐ Отзыв на «ХУЛИgan» (${rating}/5)`,
        '',
        `👤 ${booking.name}`,
        `💬 ${text}`,
        '',
        `🆔 ${bookingId}`,
        `🎁 Промокод: ${promoCode} (до ${expiresDate})`
      ].join('\n');
      await notifyAdmin(adminMsg).catch(() => { });

      // Отправляем промокод покупателю в ВК
      if (booking.vkUserId) {
        const userMsg = [
          `Спасибо за отзыв о шоу «ХУЛИgan»! 🔥`,
          '',
          `Ваш персональный промокод на скидку 200 ₽:`,
          `🎁 ${promoCode}`,
          '',
          `Действует до ${expiresDate}.`,
          'Используйте при следующей покупке билета!'
        ].join('\n');
        await vkSend(booking.vkUserId, userMsg).catch(() => { });
      }
      if (booking.tgUserId) {
        const userMsg = [
          `Спасибо за отзыв о шоу «ХУЛИgan»! 🔥`,
          '',
          `Ваш персональный промокод на скидку 200 ₽:`,
          `🎁 ${promoCode}`,
          '',
          `Действует до ${expiresDate}.`,
          'Используйте при следующей покупке билета!'
        ].join('\n');
        await tgSend(booking.tgUserId, userMsg).catch(() => { });
      }

      return res.status(200).json({ ok: true, promoCode, expiresDate });
    }

    // ── Ручное создание билета администратором ──
    if (action === 'admin_create_booking') {
      if (!(await isAdminAuthorized(req, body))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const {
        name,
        ticketType,
        finalPrice,
        vkUserId: recipientVkId,
        tgUserId: recipientTgId,
        tgUsername: recipientTgUsername,
        sendNotification
      } = body;
      if (!name || !ticketType) return res.status(400).json({ error: 'name and ticketType are required' });

      const cfg = await fbGet('huligan_config');
      const typeKey = String(ticketType);
      const typeInfo = cfg?.ticketTypes?.[typeKey] || {};
      const price = finalPrice != null ? Number(finalPrice) : (typeInfo.price != null ? Number(typeInfo.price) : 0);
      const tgId = Number.isFinite(Number(recipientTgId)) && Number(recipientTgId) > 0 ? Number(recipientTgId) : null;
      const tgUsername = String(recipientTgUsername || '').trim().replace(/\s+/g, '');
      const normalizedTgUsername = /^@?[a-zA-Z0-9_]{3,64}$/.test(tgUsername)
        ? tgUsername.replace(/^@/, '')
        : null;

      const now = Date.now();
      const newBookingId = genAdminBookingId('HUL-ADM');
      const ticketNumber = genTicketNum();

      await fbPut(`huligan_bookings/${newBookingId}`, {
        bookingId: newBookingId,
        name: String(name).trim(),
        ticketType: typeKey,
        status: 'confirmed',
        clientKey: genClientKey(),
        createdAt: now,
        confirmedAt: now,
        originalPrice: price,
        finalPrice: price,
        ticketNumber,
        adminCreated: true,
        vkUserId: recipientVkId ? Number(recipientVkId) : null,
        tgUserId: tgId,
        tgUsername: normalizedTgUsername
      });

      // Уведомляем пользователя в ВК — только ссылка на мини-апп
      let notificationWarning = null;
      if (recipientVkId && sendNotification !== false) {
        const ticketLink = buildHuliganMiniAppTicketLink(newBookingId);
        await vkSend(Number(recipientVkId), `Теперь ты тоже хулиган, а вот твой билет: ${ticketLink}`).catch(() => { });
      }
      if (tgId && sendNotification !== false) {
        await tgSendTicketReady(tgId, newBookingId).catch(() => { });
      } else if (normalizedTgUsername && sendNotification !== false) {
        notificationWarning = 'Указан только @username. Telegram не позволяет отправить сообщение без chat_id (tgUserId).';
      }

      const { token: hulToken } = makeHuliganToken(newBookingId, 1);
      const ticketUrl = `${TICKET_PUBLIC_ORIGIN}/huligan-ticket.html?id=${encodeURIComponent(newBookingId)}&tk=${encodeURIComponent(hulToken)}`;
      const miniAppUrl = buildHuliganMiniAppTicketLink(newBookingId);
      return res.status(200).json({ ok: true, bookingId: newBookingId, ticketNumber, ticketUrl, miniAppUrl, notificationWarning });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('[huligan] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
