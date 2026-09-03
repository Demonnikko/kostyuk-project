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

test('preserves VK launch parameters between show and catalog routes', async () => {
  const { buildLaunchHref } = await import('../vk-mini-app/lib/router.js');
  const locationLike = {
    pathname: '/vk-mini-app/',
    search: '?vk_user_id=42&vk_platform=mobile_web&show=secret&sign=signed',
    hash: '#launch',
  };

  assert.equal(
    buildLaunchHref(locationLike, 'huligan'),
    '/vk-mini-app/?vk_user_id=42&vk_platform=mobile_web&show=huligan&sign=signed#launch',
  );
  assert.equal(
    buildLaunchHref(locationLike, null),
    '/vk-mini-app/?vk_user_id=42&vk_platform=mobile_web&sign=signed#launch',
  );
});

test('pushes launch-aware history entries without replacing existing parameters', async () => {
  const { pushLaunchRoute } = await import('../vk-mini-app/lib/router.js');
  const calls = [];
  const historyLike = {
    pushState(state, title, href) {
      calls.push({ state, title, href });
    },
  };

  const href = pushLaunchRoute(
    historyLike,
    { pathname: '/vk-mini-app/', search: '?vk_user_id=42&show=matvey', hash: '' },
    null,
  );

  assert.equal(href, '/vk-mini-app/?vk_user_id=42');
  assert.deepEqual(calls, [{ state: {}, title: '', href: '/vk-mini-app/?vk_user_id=42' }]);
});

test('moves focus to the route heading after dynamic navigation', async () => {
  const { focusRouteHeading } = await import('../vk-mini-app/lib/router.js');
  const attributes = new Map();
  let focusOptions = null;
  const heading = {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    focus(options) {
      focusOptions = options;
    },
  };

  assert.equal(focusRouteHeading({ querySelector: (selector) => selector === 'h1' ? heading : null }), true);
  assert.equal(attributes.get('tabindex'), '-1');
  assert.deepEqual(focusOptions, { preventScroll: true });
  assert.equal(focusRouteHeading({ querySelector: () => null }), false);
});

test('ships accessible loading and unavailable states plus route focus wiring', () => {
  const html = readFileSync(join(appRoot, 'index.html'), 'utf8');
  const appSource = readFileSync(join(appRoot, 'app.js'), 'utf8');

  assert.match(html, /data-state="loading"[^>]*role="status"/);
  assert.match(html, /aria-label="Загрузка афиши"/);
  assert.doesNotMatch(html, /<main[^>]*aria-live=/);
  assert.match(appSource, /data-state="unavailable"[^>]*role="alert"/);
  assert.match(appSource, /focusRouteHeading\(app\)/);
  assert.match(appSource, /addEventListener\('popstate'/);
});

test('declares every VK safe-area inset', () => {
  const css = readFileSync(join(appRoot, 'styles.css'), 'utf8');

  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${side}\\)`));
  }
});

test('all locally referenced posters and fonts exist in the deployment tree', async () => {
  const { SHOWS } = await import('../vk-mini-app/lib/shows.js');
  const css = readFileSync(join(appRoot, 'styles.css'), 'utf8');
  const fontPaths = [...css.matchAll(/url\(['"]?(\.\.\/vendor\/fonts\/[^'")]+)['"]?\)/g)]
    .map((match) => match[1]);

  assert.equal(fontPaths.length, 2);
  for (const show of Object.values(SHOWS)) {
    assert.equal(existsSync(join(appRoot, show.poster)), true, `${show.poster} must be deployed with the app`);
  }
  for (const fontPath of fontPaths) {
    assert.equal(existsSync(join(appRoot, fontPath)), true, `${fontPath} must be deployed with the app`);
  }
});
