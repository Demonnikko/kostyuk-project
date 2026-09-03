import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const appRoot = join(projectRoot, 'vk-mini-app');
const requiredFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'lib/router.js',
  'lib/shows.js',
];

test('creates an isolated Mini App shell without a hard-coded VK app ID', async () => {
  assert.equal(existsSync(appRoot), true, 'vk-mini-app directory must exist');

  for (const relativePath of requiredFiles) {
    assert.equal(existsSync(join(appRoot, relativePath)), true, `${relativePath} must exist`);
  }

  const files = await readdir(appRoot, { recursive: true, withFileTypes: true });
  const source = files
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /\bapp(?:lication)?[_-]?id\s*[:=]\s*["']?\d+/i);
  assert.doesNotMatch(source, /vk\.com\/app\d+/i);
});

test('exports exactly the three author shows as immutable configuration', async () => {
  const { SHOWS } = await import('../vk-mini-app/lib/shows.js');

  assert.deepEqual(Object.keys(SHOWS), ['secret', 'huligan', 'matvey']);
  assert.equal(Object.isFrozen(SHOWS), true);
  assert.equal(Object.values(SHOWS).every(Object.isFrozen), true);
});

test('resolves direct show launch parameters and defaults to the catalog', async () => {
  const { parseLaunchRoute } = await import('../vk-mini-app/lib/router.js');

  assert.deepEqual(parseLaunchRoute({ search: '?show=secret' }), { show: 'secret' });
  assert.deepEqual(parseLaunchRoute({ search: '?show=huligan' }), { show: 'huligan' });
  assert.deepEqual(parseLaunchRoute({ search: '?show=matvey' }), { show: 'matvey' });
  assert.deepEqual(parseLaunchRoute({ search: '?show=unknown' }), { show: null });
  assert.deepEqual(parseLaunchRoute({ search: '' }), { show: null });
});
