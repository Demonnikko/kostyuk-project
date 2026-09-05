import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  ADMIN_SESSION_TTL_MS,
  createAdminSessionToken,
  verifyAdminSessionToken
} from '../shared/adminAuth.js';

test('admin session token uses one signing secret and expires after 180 days', () => {
  const secret = 'test-session-secret';
  const now = Date.UTC(2026, 8, 5);
  const token = createAdminSessionToken(secret, now);

  assert.equal(ADMIN_SESSION_TTL_MS, 180 * 24 * 60 * 60 * 1000);
  assert.equal(ADMIN_SESSION_MAX_AGE_SECONDS, 180 * 24 * 60 * 60);
  assert.equal(verifyAdminSessionToken(token, secret, now + 1000), true);
  assert.equal(verifyAdminSessionToken(token, `?auth=${secret}`, now + 1000), false);
  assert.equal(verifyAdminSessionToken(token, secret, now + ADMIN_SESSION_TTL_MS + 1), false);
});

test('admin proxy issues and refreshes a secure persistent cookie', async () => {
  const source = await readFile(new URL('../api/_endpoints/admin-proxy.js', import.meta.url), 'utf8');
  assert.match(source, /method === 'POST' \|\| method === 'GET'/);
  assert.match(source, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(source, /Max-Age=\$\{ADMIN_SESSION_MAX_AGE_SECONDS\}/);
  assert.doesNotMatch(source, /createAdminSessionToken\(FIREBASE_SECRET\)/);
});
