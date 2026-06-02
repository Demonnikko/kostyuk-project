import crypto from 'crypto';

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const TG_INITDATA_MAX_AGE_SEC = Number(process.env.TG_INITDATA_MAX_AGE_SEC || 86400);

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

export {
  verifyTelegramInitData,
  getTrustedTelegramUserId
};
