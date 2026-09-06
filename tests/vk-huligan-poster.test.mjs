import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('every HULIgan surface uses the Я ЗНАЛ / Париж poster', async () => {
  const canonical = await readFile(new URL('../concerts/images/huligan.png', import.meta.url));
  const copies = await Promise.all([
    readFile(new URL('../images/afisha/huligan.png', import.meta.url)),
    readFile(new URL('../ticketing-sites/public/shows/huligan.png', import.meta.url)),
    readFile(new URL('../vk-mini-app-dist/site/images/huligan.png', import.meta.url)),
    readFile(new URL('../vk-mini-app-dist/images/huligan.png', import.meta.url)),
  ]);
  for (const copy of copies) assert.deepEqual(copy, canonical);

  const [website, detail, events, miniApp, miniAppDetail, sourceShows, bundledShows] = await Promise.all([
    readFile(new URL('../concerts/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../concerts/huligan/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../events/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../vk-mini-app-dist/site/afisha.html', import.meta.url), 'utf8'),
    readFile(new URL('../vk-mini-app-dist/site/huligan.html', import.meta.url), 'utf8'),
    readFile(new URL('../vk-mini-app/lib/shows.js', import.meta.url), 'utf8'),
    readFile(new URL('../vk-mini-app-dist/lib/shows.js', import.meta.url), 'utf8'),
  ]);
  assert.match(website, /<img class="show__poster"[^>]*huligan\.png\?v=12[^>]*width="660" height="990"/);
  assert.match(detail, /<img class="poster"[^>]*huligan\.png\?v=12[^>]*width="660" height="990"/);
  assert.match(events, /<img[^>]*huligan\.png\?v=12[^>]*width="660" height="990"/);
  assert.match(miniApp, /<img class="show__poster"[^>]*huligan\.png[^>]*width="660" height="990"/);
  assert.match(miniAppDetail, /<img class="poster"[^>]*huligan\.png[^>]*width="660" height="990"/);
  assert.match(sourceShows, /poster:\s*'\.\.\/concerts\/images\/huligan\.png'/);
  assert.match(bundledShows, /poster:\s*'\.\/images\/huligan\.png'/);
});

test('HULIgan poster keeps its full 2:3 frame on website and VK', async () => {
  const [websiteCss, miniAppCss, ticketingCss, ticketingDetail] = await Promise.all([
    readFile(new URL('../concerts/show-system.css', import.meta.url), 'utf8'),
    readFile(new URL('../vk-mini-app-dist/site/css/show-system.css', import.meta.url), 'utf8'),
    readFile(new URL('../ticketing-sites/app/globals.css', import.meta.url), 'utf8'),
    readFile(new URL('../ticketing-sites/app/components/show-detail.tsx', import.meta.url), 'utf8'),
  ]);
  for (const css of [websiteCss, miniAppCss]) {
    assert.match(css, /body\.show-page--huligan \.poster-wrap\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*3/s);
    assert.match(css, /body\.show-page--huligan \.poster\s*\{[^}]*object-fit:\s*contain/s);
    assert.doesNotMatch(css, /body\.show-page--huligan \.poster-wrap\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/s);
  }
  assert.match(ticketingCss, /\.show-page--huligan \.show-detail-poster\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*3/s);
  assert.match(ticketingDetail, /content\.slug === "huligan"[\s\S]*?width:\s*660,\s*height:\s*990/);
});
