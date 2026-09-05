import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('VK catalog shows the complete 4:5 HULIgan poster', async () => {
  const html = await readFile(new URL('../vk-mini-app-dist/site/afisha.html', import.meta.url), 'utf8');
  assert.match(html, /\.show--huligan \.show__poster\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5[^}]*object-fit:\s*contain/s);
  assert.match(html, /src="\.\/images\/huligan\.webp" width="960" height="1200"/);
});
