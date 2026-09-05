import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('VK catalog uses the same HULIgan poster geometry as the website', async () => {
  const [miniApp, website] = await Promise.all([
    readFile(new URL('../vk-mini-app-dist/site/afisha.html', import.meta.url), 'utf8'),
    readFile(new URL('../concerts/index.html', import.meta.url), 'utf8')
  ]);
  const posterPattern = /<img class="show__poster"[^>]*huligan\.webp[^>]*width="720" height="1080"/;
  assert.match(miniApp, posterPattern);
  assert.match(website, posterPattern);
  assert.doesNotMatch(miniApp, /\.show--huligan \.show__poster\s*\{[^}]*aspect-ratio:/s);
});
