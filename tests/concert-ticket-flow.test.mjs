import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../concerts/ticket-flow.js');

const core = globalThis.TicketFlowCore;

test('seat selection adds and removes the same seat', () => {
  const seat = { key: 't1_s1', label: 'Стол 1, место 1', price: 1500 };
  const selected = core.toggleSelection([], seat, 10);

  assert.deepEqual(selected, [seat]);
  assert.deepEqual(core.toggleSelection(selected, seat, 10), []);
  assert.deepEqual(selected, [seat], 'helper must not mutate its input');
});

test('selection limit is enforced', () => {
  const selected = Array.from({ length: 10 }, (_, index) => ({ key: `s${index}` }));
  assert.throws(
    () => core.toggleSelection(selected, { key: 's10' }, 10),
    /максимум 10/i,
  );
});

test('only an explicit seat conflict rolls back optimistic selection', () => {
  assert.equal(core.shouldRollbackSeat(409), true);
  assert.equal(core.shouldRollbackSeat(500), false);
  assert.equal(core.shouldRollbackSeat(0), false);
  assert.equal(core.shouldRollbackSeat(undefined), false);
});

test('order draft contains complete checkout summary', () => {
  const draft = core.buildDraft({
    id: 'ORDER-1',
    show: 'Секрет',
    date: { date: '31 октября 2026', time: '18:00', venue: 'ЛАМПА · Ярославль' },
    selected: [
      { key: 't1_s1', label: 'Стол 1, место 1', price: 1500 },
      { key: 't1_s2', label: 'Стол 1, место 2', price: 1500 },
    ],
    contact: { name: 'Дмитрий', phone: '+7 999 000-00-00', telegram: '@kostyuk' },
  });

  assert.equal(draft.show, 'Секрет');
  assert.equal(draft.date, '31 октября 2026');
  assert.equal(draft.time, '18:00');
  assert.equal(draft.venue, 'ЛАМПА · Ярославль');
  assert.equal(draft.quantity, 2);
  assert.equal(draft.total, 3000);
  assert.deepEqual(draft.seats, ['Стол 1, место 1', 'Стол 1, место 2']);
  assert.equal(draft.contact.phone, '+7 999 000-00-00');
});


test('public concert pages expose only color-named price zones', () => {
  const expectations = [
    {
      slug: 'secret',
      legendCount: 3,
      minPrice: 'Билеты от 1200 ₽',
      zones: {
        vip: { label: 'Красная зона', price: 1800, color: '#e85348' },
        standart: { label: 'Зелёная зона', price: 1500, color: '#3dbf6e' },
        econom: { label: 'Синяя зона', price: 1200, color: '#4a8fd9' },
        sofa_left: { label: 'Левый диван', price: 1000, color: '#b890ff' },
        sofa_right: { label: 'Правый диван', price: 800, color: '#3fbfc0' },
        bar: { label: 'Оранжевая зона', price: 800, color: '#f0913d' },
        lampa: { label: 'Красная зона', price: 1800, color: '#e85348' },
      },
    },
    {
      slug: 'huligan',
      legendCount: 5,
      minPrice: 'Билеты от 1100 ₽',
      zones: {
        vip: { label: 'Красная зона', price: 1700, color: '#e85348' },
        standart: { label: 'Зелёная зона', price: 1400, color: '#3dbf6e' },
        econom: { label: 'Синяя зона', price: 1100, color: '#4a8fd9' },
        sofa: { label: 'Красная зона', price: 1700, color: '#e85348' },
        lampa: { label: 'Красная зона', price: 1700, color: '#e85348' },
      },
    },
    {
      slug: 'matvey',
      legendCount: 3,
      minPrice: 'Билеты от 1100 ₽',
      zones: {
        row_front: { label: 'Красная зона', price: 1700, color: '#e85348' },
        table: { label: 'Синяя зона', price: 1100, color: '#4a8fd9' },
        row_back: { label: 'Зелёная зона', price: 1400, color: '#3dbf6e' },
        sofa: { label: 'Красная зона', price: 1700, color: '#e85348' },
        lampa: { label: 'Красная зона', price: 1700, color: '#e85348' },
      },
    },
  ];

  for (const show of expectations) {
    const html = readFileSync(new URL(`../concerts/${show.slug}/index.html`, import.meta.url), 'utf8');
    const legend = html.match(/<div class="legend"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div class="cart"/)?.[1] || '';
    const zones = html.match(/var ZONES = \{([\s\S]*?)\n    \};/)?.[1] || '';

    assert.ok(html.includes(show.minPrice), `${show.slug} should show the requested minimum price`);
    assert.equal((legend.match(/class="ldot"/g) || []).length, show.legendCount, `${show.slug} legend should list every visible zone`);
    assert.match(legend, /Синяя(?: зона)?/, `${show.slug} legend should include blue zone`);
    assert.match(legend, /Зелёная(?: зона)?/, `${show.slug} legend should include green zone`);
    assert.match(legend, /Красная(?: зона)?/, `${show.slug} legend should include red zone`);
    assert.doesNotMatch(legend, /Низкая|Средняя|Высокая|Ближе к сцене|Стандарт|Эконом|Диваны|Зона Лампа|Ряды|Столики/);

    for (const [zone, expected] of Object.entries(show.zones)) {
      const pattern = new RegExp(`${zone}:\\s*\\{[^}]*color:\\s*'${expected.color}'[^}]*label:\\s*'${expected.label}'[^}]*price:\\s*${expected.price}\\b`, 's');
      assert.match(zones, pattern, `${show.slug} ${zone} should map to ${expected.label} for ${expected.price}`);
    }
  }
});


test('server and admin defaults follow the same ticket tier prices', () => {
  const secretEndpoint = readFileSync(new URL('../api/_endpoints/book.js', import.meta.url), 'utf8');
  const huliganEndpoint = readFileSync(new URL('../api/_endpoints/huligan.js', import.meta.url), 'utf8');
  const adminPage = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');

  assert.match(secretEndpoint, /vip:\s*1800[\s\S]*standart:\s*1500[\s\S]*econom:\s*1200[\s\S]*sofa_left:\s*1000[\s\S]*sofa_right:\s*800[\s\S]*bar:\s*800[\s\S]*lampa:\s*1800/);
  assert.match(huliganEndpoint, /\{\s*vip:\s*1700,\s*std:\s*1400,\s*eco:\s*1100\s*\}/);
  assert.doesNotMatch(adminPage, /VIP — 1400|Стандарт — 1100|Эконом — 800|Высокая — 1800|Средняя — 1500|Низкая — 1200|id="priceEconom" type="number" placeholder="800"|id="priceMatBack" type="number" placeholder="800"|id="priceMatSofa" type="number" placeholder="4000"|id="priceMatLampa" type="number" placeholder="2500"|Ряд 1-4 — свободно|Ряд 5-7 — свободно|Столы — свободно/);
  assert.match(adminPage, /Красная зона — 1800 ₽/);
  assert.match(adminPage, /Зелёная зона — 1500 ₽/);
  assert.match(adminPage, /Синяя зона — 1200 ₽/);
});
