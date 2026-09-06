import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('VK catalog shows the complete HULIgan poster without horizontal cropping', async () => {
  const [miniApp, website] = await Promise.all([
    readFile(new URL('../vk-mini-app-dist/site/afisha.html', import.meta.url), 'utf8'),
    readFile(new URL('../concerts/index.html', import.meta.url), 'utf8')
  ]);
  assert.match(website, /<img class="show__poster"[^>]*huligan\.webp/);
  assert.match(miniApp, /<img class="show__poster"[^>]*huligan\.webp[^>]*width="960" height="1200"/);
  assert.match(
    miniApp,
    /\.show--huligan \.show__poster\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5[^}]*object-fit:\s*contain/s,
  );
});
