import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
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

test('ships accessible loading and unavailable states', () => {
  const html = readFileSync(join(appRoot, 'index.html'), 'utf8');
  const appSource = readFileSync(join(appRoot, 'app.js'), 'utf8');

  assert.match(html, /data-state="loading"[^>]*role="status"/);
  assert.match(html, /aria-label="Загрузка афиши"/);
  assert.doesNotMatch(html, /<main[^>]*aria-live=/);
  assert.match(appSource, /data-state="unavailable"[^>]*role="alert"/);
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

test('real browser preserves VK context, renders routes, and focuses headings through history', { timeout: 30_000 }, async (t) => {
  const browserCandidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const executablePath = browserCandidates.find(existsSync);
  if (!executablePath) {
    t.skip(`No local Chrome/Chromium executable found in: ${browserCandidates.join(', ')}`);
    return;
  }

  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
      const filePath = normalize(join(projectRoot, pathname));
      if (!filePath.startsWith(projectRoot)) throw new Error('Path outside project root');
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { default: puppeteer } = await import('puppeteer-core');
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const port = server.address().port;
    const launchUrl = `http://127.0.0.1:${port}/vk-mini-app/?vk_user_id=123&vk_app_id=54751520#launch`;

    const readRouteState = () => page.evaluate(() => {
      const heading = document.querySelector('h1');
      const params = new URLSearchParams(window.location.search);
      return {
        heading: heading?.textContent,
        focusedHeading: document.activeElement === heading,
        hash: window.location.hash,
        show: params.get('show'),
        vkAppId: params.get('vk_app_id'),
        vkUserId: params.get('vk_user_id'),
      };
    });
    const waitForHeading = (heading) => page.waitForFunction(
      (expected) => document.querySelector('h1')?.textContent === expected,
      {},
      heading,
    );
    const assertRoute = async ({ heading, show }) => {
      assert.deepEqual(await readRouteState(), {
        heading,
        focusedHeading: true,
        hash: '#launch',
        show,
        vkAppId: '54751520',
        vkUserId: '123',
      });
    };

    const launchResponse = await page.goto(launchUrl, { waitUntil: 'load' });
    await page.waitForSelector('[data-show-route="secret"]', { timeout: 5_000 }).catch(async (error) => {
      const heading = await page.$eval('h1', (element) => element.textContent).catch(() => null);
      throw new Error(`${error.message}; HTTP ${launchResponse?.status()}; h1=${heading}; pageErrors=${pageErrors.join(' | ')}`);
    });
    await page.click('[data-show-route="secret"]');
    await waitForHeading('Секрет');
    await assertRoute({ heading: 'Секрет', show: 'secret' });

    await page.goBack({ waitUntil: 'load' });
    await waitForHeading('Авторские шоу');
    await assertRoute({ heading: 'Авторские шоу', show: null });

    await page.goForward({ waitUntil: 'load' });
    await waitForHeading('Секрет');
    await assertRoute({ heading: 'Секрет', show: 'secret' });

    await page.click('.show-detail__back');
    await waitForHeading('Авторские шоу');
    await assertRoute({ heading: 'Авторские шоу', show: null });
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
