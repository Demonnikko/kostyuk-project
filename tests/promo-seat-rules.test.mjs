import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkPromoSeatRules, normalizePromoSeatKeys } from '../shared/promoRules.js';

function createJsonResponse(status, payload) {
  let responseBody = null;
  return {
    status(code) { status = code; return this; },
    json(value) { responseBody = value; return value; },
    end() {},
    setHeader() {},
    result() { return { status, body: responseBody }; },
  };
}

test('normalizes comma, space and semicolon separated seat keys', () => {
  assert.deepEqual(normalizePromoSeatKeys(' T1_1, t1_2; BAR_1 t1_1 '), ['t1_1', 't1_2', 'bar_1']);
});

test('allows unrestricted promos for any selected seats', () => {
  assert.deepEqual(checkPromoSeatRules({}, [{ key: 't1_1' }]), { ok: true });
});

test('requires every selected seat to be in the allowed list', () => {
  const promo = { allowedSeatKeys: ['t1_1', 't1_2'] };
  assert.equal(checkPromoSeatRules(promo, [{ key: 't1_1' }, { key: 't1_2' }]).ok, true);
  assert.deepEqual(checkPromoSeatRules(promo, [{ key: 't1_1' }, { key: 't2_1' }]), { ok: false, reason: 'seat_not_allowed' });
});

test('rejects any explicitly excluded seat', () => {
  assert.deepEqual(
    checkPromoSeatRules({ excludedSeatKeys: ['bar_1'] }, [{ key: 'bar_1' }]),
    { ok: false, reason: 'seat_excluded' },
  );
});

test('admin persists use limits and seat restrictions for every promo type', async () => {
  const admin = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
  for (const id of ['adUses', 'adAllowedSeats', 'adExcludedSeats', 'newPromoAllowedSeats', 'newPromoExcludedSeats', 'hulNewPromoAllowedSeats', 'hulNewPromoExcludedSeats', 'matNewPromoAllowedSeats', 'matNewPromoExcludedSeats']) {
    assert.match(admin, new RegExp(`id="${id}"`));
  }
  assert.match(admin, /usesLeft:\s*uses/);
  assert.match(admin, /allowedSeatKeys/);
  assert.match(admin, /excludedSeatKeys/);
});

test('all booking endpoints enforce promo seat rules on the server', async () => {
  const sources = await Promise.all(['book', 'huligan', 'matvey'].map((name) =>
    readFile(new URL(`../api/_endpoints/${name}.js`, import.meta.url), 'utf8')));
  for (const source of sources) assert.match(source, /checkPromoSeatRules\(promo, seats\)\.ok/);
});

test('website and VK checkout include selected seat keys in promo validation', async () => {
  const pages = await Promise.all([
    'concerts/secret/index.html', 'concerts/huligan/index.html', 'concerts/matvey/index.html',
    'vk-mini-app-dist/site/secret.html', 'vk-mini-app-dist/site/huligan.html',
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  for (const page of pages) assert.match(page, /seatKeys/);
});

test('Huligan public GET validates a promo without admin authorization', async () => {
  const originalFetch = globalThis.fetch;
  const originalDbUrl = process.env.FIREBASE_DB_URL;
  const originalSecret = process.env.FIREBASE_SECRET;
  process.env.FIREBASE_DB_URL = 'https://firebase.test';
  process.env.FIREBASE_SECRET = 'test-secret';

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/huligan_bookings.json')) {
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/huligan_promo/AFISHA.json')) {
      return {
        ok: true,
        json: async () => ({
          active: true,
          type: 'percent',
          value: 10,
          usesLeft: -1,
          excludedSeatKeys: ['bar_2'],
        }),
      };
    }
    throw new Error(`Unexpected Firebase request: ${url}`);
  };

  try {
    const { default: handler } = await import(`../api/_endpoints/huligan.js?promo-get=${Date.now()}`);
    const req = {
      method: 'GET',
      query: { action: 'get_promo', code: 'AFISHA', seats: 'bar_1' },
      headers: {},
    };
    const res = createJsonResponse(200, null);

    await handler(req, res);

    assert.deepEqual(res.result(), {
      status: 200,
      body: {
        active: true,
        activeNow: true,
        type: 'percent',
        value: 10,
        usesLeft: -1,
        expiresAt: null,
        validFrom: null,
        validUntil: null,
        description: null,
        restrictionReason: null,
      },
    });

    const restrictedReq = {
      method: 'GET',
      query: { action: 'get_promo', code: 'AFISHA', seats: 'bar_2' },
      headers: {},
    };
    const restrictedRes = createJsonResponse(200, null);

    await handler(restrictedReq, restrictedRes);

    assert.equal(restrictedRes.result().status, 200);
    assert.equal(restrictedRes.result().body.active, false);
    assert.equal(restrictedRes.result().body.activeNow, false);
    assert.equal(restrictedRes.result().body.restrictionReason, 'seat_excluded');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDbUrl === undefined) delete process.env.FIREBASE_DB_URL;
    else process.env.FIREBASE_DB_URL = originalDbUrl;
    if (originalSecret === undefined) delete process.env.FIREBASE_SECRET;
    else process.env.FIREBASE_SECRET = originalSecret;
  }
});
