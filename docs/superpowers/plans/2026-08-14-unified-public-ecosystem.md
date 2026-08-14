# Unified Public KOSTYUK PROJECT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить единый премиальный публичный слой KOSTYUK PROJECT с официальной монограммой, прямыми адресами `/shows`, `/events`, `/school` и последовательной мобильной иерархией.

**Architecture:** Статические страницы остаются самостоятельными и используют общий `ecosystem.css`/`ecosystem.js` как дизайн-систему. Канонические чистые адреса сопоставляются существующим каталогам через единый маршрутный контракт, а старые ссылки сохраняются постоянными перенаправлениями. Билетное ядро не переписывается в этом релизе.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript ES modules, Node.js `>=20`, Vercel routes, Node test runner, Service Worker.

## Global Constraints

- Использовать только официальную переплетённую монограмму KP из `images/brand/kostyuk-project-monogram-square-v1.png`; не заменять её набранными буквами.
- Канонические маршруты: `/`, `/shows`, `/shows/<slug>`, `/events`, `/school`, `/admin`.
- Хаб не является обязательной промежуточной страницей.
- Cinzel используется для заголовков, Inter — для основного текста.
- Основные цвета берутся только из общих CSS-переменных: почти чёрный фон, тёплое матовое золото, молочный текст, тёплый серый вторичный текст.
- На каждом разделе одно первичное действие: «Выбрать места», «Рассчитать выступление», «Записаться на пробное занятие» или «Выбрать направление».
- Не изменять утверждённые афиши, фактические даты, цены, отзывы и схемы залов.
- Поддержать ширины `320`, `375`, `390`, `430`, `768`, `1024`, `1440`, `1920` px, safe areas и `prefers-reduced-motion`.
- Не добавлять новых runtime-зависимостей.

## File Structure

- `shared/publicRoutes.js` — единственный JS-контракт канонических и физических статических маршрутов для локального сервера и тестов.
- `tests/ecosystem-routes.test.mjs` — маршруты, старые ссылки, канонические адреса и официальный логотип.
- `tests/ecosystem-content.test.mjs` — первичные CTA, порядок перекрёстных предложений и отсутствие фиктивного контента.
- `help/index.html` — единая публичная точка помощи без раскрытия данных заказа.
- `ecosystem.css` — общие токены, шапка, переключатель, подвал, кнопки и адаптивные правила.
- `ecosystem.js` — общая разметка оболочки и доступное управление переключателем проектов.
- `hub.css`, `index.html` — только хаб и три направления.
- `concerts/**`, `events/**`, `school/**` — предметный контент; общие компоненты из них удаляются в пользу общей оболочки.
- `vercel.json`, `server.js`, `sitemap.xml`, `robots.txt`, `sw.js` — маршрутизация, индексация и безопасное обновление кэша.

---

### Task 1: Зафиксировать контракт чистых маршрутов

**Files:**
- Create: `shared/publicRoutes.js`
- Create: `tests/ecosystem-routes.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `PUBLIC_ROUTES: Readonly<Record<string, string>>`
- Produces: `LEGACY_REDIRECTS: Readonly<Record<string, string>>`
- Produces: `resolvePublicFile(pathname: string): string | null`
- Consumes: существующие физические файлы `index.html`, `concerts/**/index.html`, `events/index.html`, `school/index.html`, `admin/index.html`.

- [ ] **Step 1: Написать падающий маршрутный тест**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PUBLIC_ROUTES, LEGACY_REDIRECTS, resolvePublicFile } from "../shared/publicRoutes.js";

test("clean public routes resolve without forcing the hub", () => {
  assert.equal(resolvePublicFile("/"), "index.html");
  assert.equal(resolvePublicFile("/shows"), "concerts/index.html");
  assert.equal(resolvePublicFile("/shows/huligan"), "concerts/huligan/index.html");
  assert.equal(resolvePublicFile("/events"), "events/index.html");
  assert.equal(resolvePublicFile("/school"), "school/index.html");
  assert.equal(resolvePublicFile("/admin"), "admin/index.html");
  assert.equal(PUBLIC_ROUTES.shows, "/shows");
  assert.equal(LEGACY_REDIRECTS["/concerts"], "/shows");
});

test("vercel routing mirrors the route contract", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url)));
  assert.ok(config.rewrites.some((item) => item.source === "/shows" && item.destination === "/concerts/index.html"));
  assert.ok(config.redirects.some((item) => item.source === "/concerts" && item.destination === "/shows"));
});
```

- [ ] **Step 2: Запустить тест и подтвердить ожидаемое падение**

Run: `node --test tests/ecosystem-routes.test.mjs`

Expected: FAIL с `ERR_MODULE_NOT_FOUND` для `shared/publicRoutes.js`.

- [ ] **Step 3: Реализовать минимальный маршрутный контракт**

```js
export const PUBLIC_ROUTES = Object.freeze({
  hub: "/",
  shows: "/shows",
  events: "/events",
  school: "/school",
  admin: "/admin",
});

export const LEGACY_REDIRECTS = Object.freeze({
  "/concerts": "/shows",
  "/concerts/": "/shows",
  "/concerts/huligan": "/shows/huligan",
  "/concerts/secret": "/shows/secret",
  "/concerts/matvey": "/shows/matvey",
});

const FILES = Object.freeze({
  "/": "index.html",
  "/shows": "concerts/index.html",
  "/shows/huligan": "concerts/huligan/index.html",
  "/shows/secret": "concerts/secret/index.html",
  "/shows/matvey": "concerts/matvey/index.html",
  "/events": "events/index.html",
  "/school": "school/index.html",
  "/admin": "admin/index.html",
});

export function resolvePublicFile(pathname) {
  const normalized = pathname !== "/" ? String(pathname).replace(/\/+$/, "") : "/";
  return FILES[normalized] ?? null;
}
```

- [ ] **Step 4: Подключить все корневые тесты**

Change `package.json`:

```json
"test": "node --test tests/*.test.mjs"
```

- [ ] **Step 5: Запустить тесты**

Run: `npm test`

Expected: новые маршрутные проверки проходят; существующий `concert-ticket-flow.test.mjs` остаётся зелёным.

- [ ] **Step 6: Commit**

```bash
git add shared/publicRoutes.js tests/ecosystem-routes.test.mjs package.json
git commit -m "test: lock canonical ecosystem routes"
```

### Task 2: Подключить чистые адреса локально и на Vercel

**Files:**
- Modify: `server.js`
- Modify: `vercel.json`
- Modify: `sitemap.xml`
- Modify: `robots.txt`
- Test: `tests/ecosystem-routes.test.mjs`

**Interfaces:**
- Consumes: `resolvePublicFile(pathname)` и `LEGACY_REDIRECTS` из `shared/publicRoutes.js`.
- Produces: одинаковое поведение `GET /shows[/slug]` в `node server.js` и Vercel.

- [ ] **Step 1: Дополнить падающий тест локального контракта**

```js
test("every canonical path is represented in sitemap", async () => {
  const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");
  for (const path of ["/", "/shows", "/shows/huligan", "/shows/secret", "/shows/matvey", "/events", "/school"]) {
    assert.match(sitemap, new RegExp(`<loc>[^<]+${path === "/" ? "/" : path}</loc>`));
  }
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `node --test tests/ecosystem-routes.test.mjs`

Expected: FAIL, потому что sitemap и Vercel ещё содержат старые адреса.

- [ ] **Step 3: Использовать маршрутный контракт в локальном сервере**

В `server.js` импортировать контракт и перед `resolveStaticPath` обрабатывать redirect и physical file:

```js
import { LEGACY_REDIRECTS, resolvePublicFile } from "./shared/publicRoutes.js";

const legacyTarget = LEGACY_REDIRECTS[url.pathname.replace(/\/+$/, "") || "/"];
if (legacyTarget) {
  res.writeHead(308, { Location: legacyTarget, "Cache-Control": "no-store" });
  return res.end();
}
const publicFile = resolvePublicFile(url.pathname);
if (publicFile) filePath = path.join(rootDir, publicFile);
```

- [ ] **Step 4: Зеркально настроить Vercel**

Добавить точные rewrites `/shows`, `/shows/huligan`, `/shows/secret`, `/shows/matvey`, `/events`, `/school`, `/admin` на существующие файлы. Добавить постоянные redirects со старых `/concerts`-адресов на `/shows`-адреса. Существующие `/admin.html` и `/admin-private` оставить совместимыми.

- [ ] **Step 5: Обновить индексирование**

В `sitemap.xml` оставить только канонические URL. В `robots.txt` закрыть `/admin`, `/api/` и страницы заказа от индексации, не закрывая `/shows`, `/events`, `/school`.

- [ ] **Step 6: Проверить маршруты**

Run: `npm test`

Run: `PORT=4176 npm start`

Expected: `curl -I http://127.0.0.1:4176/shows` возвращает `200`; `curl -I http://127.0.0.1:4176/concerts` возвращает `308` с `Location: /shows`.

- [ ] **Step 7: Commit**

```bash
git add server.js vercel.json sitemap.xml robots.txt tests/ecosystem-routes.test.mjs
git commit -m "feat: add direct ecosystem routes"
```

### Task 3: Заменить старую айдентику общей оболочкой

**Files:**
- Modify: `ecosystem.js`
- Modify: `ecosystem.css`
- Create: `help/index.html`
- Create: `tests/ecosystem-content.test.mjs`
- Test: `tests/ecosystem-routes.test.mjs`

**Interfaces:**
- Produces: `DIRECTIONS` со ссылками `/shows`, `/events`, `/school`.
- Produces DOM: `.brand-bar`, `#projectSwitcher`, `.kp-footer`.
- Produces: публичную страницу `/help` с безопасным маршрутом в поддержку.
- Consumes: `/images/brand/kostyuk-project-monogram-square-v1.png`.

- [ ] **Step 1: Написать контракт официального бренда**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared shell uses the official mark and canonical project links", async () => {
  const source = await read("ecosystem.js");
  assert.match(source, /images\/brand\/kostyuk-project-monogram-square-v1\.png/);
  assert.doesNotMatch(source, /images\/kostyuk-project-logo\.jpg/);
  for (const href of ["/shows", "/events", "/school"]) assert.ok(source.includes(href));
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `node --test tests/ecosystem-content.test.mjs`

Expected: FAIL на старом `images/kostyuk-project-logo.jpg` и старых `index.html`-ссылках.

- [ ] **Step 3: Обновить общую разметку**

В `ecosystem.js`:

```js
var DIRECTIONS = [
  { key: "shows", href: "/shows", title: "Авторские шоу", sub: "Афиша · билеты · гастроли", cta: "Смотреть афишу" },
  { key: "events", href: "/events", title: "Частные события", sub: "Свадьбы · корпоративы · праздники", cta: "Рассчитать выступление" },
  { key: "school", href: "/school", title: "Школа фокусов", sub: "Обучение детей 7–13 лет", cta: "Записаться" },
];
var BRAND_MARK = "/images/brand/kostyuk-project-monogram-square-v1.png";
```

Использовать `BRAND_MARK` в шапке. В подвале не повторять крупный знак: оставить направления, «Помощь с заказом», юридические ссылки билетного направления и копирайт. Добавить восстановление фокуса на кнопку открытия, focus trap внутри диалога и закрытие по Escape/клику фона.

- [ ] **Step 4: Создать безопасную общую страницу помощи**

`help/index.html` объясняет два пути: открыть защищённую ссылку заказа из подтверждения либо написать в действующий VK/Telegram-канал поддержки. Страница не принимает номер заказа в открытом URL, не показывает существование заказа и не обещает автоматический возврат денег. Для частного события и школы она ведёт в соответствующую форму связи.

- [ ] **Step 5: Уплотнить премиальную оболочку**

В `ecosystem.css` сохранить общие токены и привести шапку к `height: 58px` desktop / `52px` mobile, логотип к `40px` / `36px`, область нажатия к минимуму `44px`. Добавить `padding-top: env(safe-area-inset-top)` и отключить необязательное движение внутри `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 6: Проверить**

Run: `npm test`

Expected: брендовый контракт и существующие тесты проходят.

- [ ] **Step 7: Commit**

```bash
git add ecosystem.js ecosystem.css help/index.html tests/ecosystem-content.test.mjs
git commit -m "feat: apply official Kostyuk Project shell"
```

### Task 4: Пересобрать хаб как точку выбора, а не обязательный шлюз

**Files:**
- Modify: `index.html`
- Modify: `hub.css`
- Test: `tests/ecosystem-content.test.mjs`

**Interfaces:**
- Consumes: общую оболочку из `ecosystem.js` и три фоновых изображения `images/directions/direction-*-live.webp`.
- Produces: три прямые карточки направлений и CTA «Выбрать направление».

- [ ] **Step 1: Зафиксировать семантический контракт**

```js
test("hub offers three direct choices without inline layout styles", async () => {
  const html = await read("index.html");
  assert.equal((html.match(/class="direction direction--/g) ?? []).length, 3);
  for (const href of ["href=\"/shows\"", "href=\"/events\"", "href=\"/school\""]) assert.ok(html.includes(href));
  assert.doesNotMatch(html, /<section class="hub-hero"[^>]+style=/);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `node --test tests/ecosystem-content.test.mjs`

Expected: FAIL на относительных адресах и inline-стилях.

- [ ] **Step 3: Очистить HTML**

Оставить последовательность: брендовый герой → короткое позиционирование → три направления → доказательства. Перенести визуальные значения из `style` в именованные классы `hub-hero__content`, `hub-direction-label`, `direction-grid`, `hub-proof-mini`. Ссылки заменить на `/shows`, `/events`, `/school`.

- [ ] **Step 4: Настроить карточки**

В `hub.css` каждая карточка использует собственное `background-image`, общий градиент читаемости и одинаковую высоту. На `max-width: 767px` карточки имеют `min-height: 210px`, текст остаётся видимым без hover, а три карточки не превращаются в три полноэкранных слайда.

- [ ] **Step 5: Проверить**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html hub.css tests/ecosystem-content.test.mjs
git commit -m "feat: refine direct-choice ecosystem hub"
```

### Task 5: Унифицировать первичные CTA и вторичные предложения

**Files:**
- Modify: `concerts/index.html`
- Modify: `concerts/huligan/index.html`
- Modify: `concerts/secret/index.html`
- Modify: `concerts/matvey/index.html`
- Modify: `concerts/show-system.css`
- Modify: `events/index.html`
- Modify: `events/events.css`
- Modify: `school/index.html`
- Modify: `school/school.css`
- Test: `tests/ecosystem-content.test.mjs`

**Interfaces:**
- Produces: первичный CTA каждого направления и `.kp-ecosystem-promo` после основного конверсионного блока.
- Consumes: канонические адреса и общие кнопки из `ecosystem.css`.

- [ ] **Step 1: Добавить контентный тест**

```js
test("each direction prioritizes its own conversion action", async () => {
  const shows = await read("concerts/index.html");
  const events = await read("events/index.html");
  const school = await read("school/index.html");
  assert.match(shows, /Выбрать места|Купить билет/);
  assert.match(events, /Рассчитать выступление/);
  assert.match(school, /Записаться на пробное занятие/);
  assert.ok(events.indexOf("Рассчитать выступление") < events.indexOf("kp-ecosystem-promo"));
  assert.ok(school.indexOf("Записаться на пробное занятие") < school.indexOf("kp-ecosystem-promo"));
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `node --test tests/ecosystem-content.test.mjs`

Expected: FAIL там, где CTA или порядок ещё не соответствуют контракту.

- [ ] **Step 3: Исправить ссылки и формулировки**

Заменить все `/concerts/index.html`, `../events/index.html`, `../school/index.html` на `/shows`, `/events`, `/school`. На витрине шоу все карточки ведут на `/shows/<slug>`. На внутренних шоу основной CTA — «Выбрать места»; перекрёстные ссылки располагаются после описания и основного CTA, а не сразу под героем.

- [ ] **Step 4: Убрать локальные дубли общих компонентов**

Удалить повторяющиеся стили кнопок, footer и project switcher из предметных CSS только после подтверждения, что общий селектор полностью их покрывает. Сохранить уникальные стили афиш, форматов частного шоу и программы школы.

- [ ] **Step 5: Проверить фактический контент**

Сверить даты, адрес, возраст, цены и длительность с текущими страницами и `ticketing-sites/lib/catalog.ts`. Не менять значение, если источники расходятся: пометить конкретное расхождение в walkthrough, не угадывать.

- [ ] **Step 6: Запустить тесты**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add concerts events school tests/ecosystem-content.test.mjs
git commit -m "feat: unify public conversion hierarchy"
```

### Task 6: Сделать мобильный фон живым, быстрым и различимым

**Files:**
- Modify: `hub.css`
- Modify: `events/events.css`
- Modify: `school/school.css`
- Modify: `concerts/show-system.css`
- Modify: `events/index.html`
- Test: `tests/ecosystem-content.test.mjs`

**Interfaces:**
- Consumes: существующие WebP направления и реальную фотографию/постер каждого раздела.
- Produces: уникальный фон каждого проекта с контрастным текстовым слоем и reduced-motion fallback.

- [ ] **Step 1: Зафиксировать отсутствие тяжёлого MOV в автозагрузке**

```js
test("public pages never autoplay MOV and every video has a poster", async () => {
  const events = await read("events/index.html");
  const school = await read("school/index.html");
  assert.doesNotMatch(events, /<source[^>]+\.mov/i);
  for (const video of [...events.matchAll(/<video[\s\S]*?<\/video>/g), ...school.matchAll(/<video[\s\S]*?<\/video>/g)]) {
    assert.match(video[0], /poster=/i);
  }
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `node --test tests/ecosystem-content.test.mjs`

Expected: FAIL на `../video/промо.mov`.

- [ ] **Step 3: Убрать MOV и определить fallback**

В шоуриле событий оставить `preload="metadata"`, `playsinline`, реальный poster и только совместимый оптимизированный MP4/WebM, если файл существует. При отсутствии оптимизированного файла оставить poster и кнопку воспроизведения без битого `<source>`.

- [ ] **Step 4: Развести визуальные миры**

Хаб использует портрет как личную точку входа; события — `direction-events-live.webp` или оптимизированное событийное видео; школа — `direction-school-live.webp`/реальные занятия; шоу — афиши и сценический свет. Для каждого фона определить отдельный `object-position` на mobile.

- [ ] **Step 5: Проверить**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hub.css events school concerts/show-system.css tests/ecosystem-content.test.mjs
git commit -m "perf: separate and optimize ecosystem media"
```

### Task 7: Обновить Service Worker без устаревших экранов

**Files:**
- Modify: `sw.js`
- Modify: `manifest.json`
- Test: `tests/ecosystem-routes.test.mjs`

**Interfaces:**
- Produces: новый `CACHE_NAME` и network-first навигацию.
- Consumes: канонические маршруты и текущие статические assets.

- [ ] **Step 1: Добавить тест стратегии навигации**

```js
test("service worker treats navigation as network-first", async () => {
  const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(source, /request\.mode\s*===\s*["']navigate["']/);
  assert.doesNotMatch(source, /images\/kostyuk-project-logo\.jpg/);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `node --test tests/ecosystem-routes.test.mjs`

Expected: FAIL, потому что текущая статика cache-first.

- [ ] **Step 3: Реализовать безопасное обновление**

Увеличить версию кэша. Для `request.mode === "navigate"` сначала запрашивать сеть, затем обновлять кэш и только при сетевой ошибке использовать сохранённую страницу/`404.html`. API не кэшировать. Для immutable изображений и шрифтов оставить cache-first.

- [ ] **Step 4: Обновить manifest**

Использовать официальные иконки/цвет `#030303`; `start_url` оставить `/`, а shortcuts добавить для `/shows`, `/events`, `/school`.

- [ ] **Step 5: Проверить**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sw.js manifest.json tests/ecosystem-routes.test.mjs
git commit -m "fix: prevent stale ecosystem navigation"
```

### Task 8: Визуально проверить публичный релиз

**Files:**
- Create: `docs/superpowers/walkthroughs/2026-08-14-unified-public-ecosystem-walkthrough.md`
- Modify only if a defect is found: files from Tasks 2–7.

**Interfaces:**
- Consumes: весь публичный контракт.
- Produces: подтверждённая матрица маршрутов и размеров экрана.

- [ ] **Step 1: Запустить автоматические проверки**

Run: `npm test`

Expected: все тесты проходят.

- [ ] **Step 2: Запустить локальный сервер**

Run: `PORT=4176 npm start`

Expected: сервер доступен на `http://127.0.0.1:4176`.

- [ ] **Step 3: Проверить маршруты в браузере**

Открыть `/`, `/shows`, три `/shows/<slug>`, `/events`, `/school`. На каждом маршруте проверить официальный знак, отсутствие обязательного возврата на хаб, первичный CTA, вторичную экосистемную плашку после основного действия и отсутствие битых ресурсов.

- [ ] **Step 4: Проверить размеры**

Снять скриншоты на `320×720`, `390×844`, `768×1024`, `1440×900`, `1920×1080`. Зафиксировать в walkthrough: горизонтальный overflow `0`, шапка не перекрывает заголовок, кнопки минимум `44px`, карточки не занимают экран без необходимости.

- [ ] **Step 5: Проверить деградацию**

Включить reduced motion, медленную сеть и отключение изображений. Убедиться, что CTA, заголовки и навигация остаются доступны.

- [ ] **Step 6: Записать walkthrough**

Документ должен перечислять точные URL, размеры, команды, результаты тестов и известные ограничения; не заявлять готовность билетных платежей в этом релизе.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/walkthroughs/2026-08-14-unified-public-ecosystem-walkthrough.md
git commit -m "docs: verify unified public ecosystem"
```
