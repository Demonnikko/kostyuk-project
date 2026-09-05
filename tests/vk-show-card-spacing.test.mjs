import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('VK show pages keep the visit strip below the sales cards', async () => {
  const css = await readFile(new URL('../vk-mini-app-dist/site/css/mini-app-fix.css', import.meta.url), 'utf8');
  assert.match(css, /\.show-visit-strip\s*\{\s*margin-top:\s*16px\s*!important;/);

  for (const show of ['huligan', 'secret', 'matvey']) {
    const html = await readFile(new URL(`../vk-mini-app-dist/site/${show}.html`, import.meta.url), 'utf8');
    assert.match(html, /class="show-sales-card show-sales-card--action"/);
    assert.match(html, /class="show-visit-strip"/);
    assert.ok(html.indexOf('show-sales-card--action') < html.indexOf('class="show-visit-strip"'));
  }
});
