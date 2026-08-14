# Unified Owner Admin and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить существующий концертный центр управления в единую защищённую админку владельца для билетов, возвратов, поддержки и частных заявок, а затем доказуемо проверить выпуск.

**Architecture:** Владелец продолжает входить через существующую HttpOnly-сессию и Touch ID/passkey. Новые предметные вкладки получают отдельные компоненты, репозитории и API, чтобы не раздувать `admin-control-center.tsx`. Частные заявки сначала сохраняются в D1 и только затем отправляют уведомление в Telegram; Telegram перестаёт быть источником истины.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Vite 8, Cloudflare Worker + D1, Drizzle ORM, WebAuthn, root Vercel serverless API, Node tests.

## Global Constraints

- Админка предназначена одному владельцу; публичной регистрации и ролей в первом релизе нет.
- Touch ID/passkey привязывается отдельно к production HTTPS origin; пароль остаётся резервным способом.
- Статус оплаты не меняется обычной UI-кнопкой.
- Денежные, массовые и необратимые действия требуют резюме, причины и второго подтверждения.
- Заказы, заявки, обращения, возвраты и audit events не удаляются через интерфейс.
- Telegram — дополнительное уведомление, а не единственное хранилище.
- Секреты не попадают в браузер, Git, логи и JSON-ответы.
- Новая админка использует официальный `/kostyuk-project-monogram-square-v1.png`, а не текстовую заглушку `KP`.
- Любая вкладка имеет loading, empty, error и stale-data состояние.
- Live-оплата остаётся выключенной до отдельного провайдер-специфичного релиза.

## File Structure

- `ticketing-sites/lib/private-lead-domain.ts` — чистая нормализация заявки и переходы pipeline.
- `ticketing-sites/lib/private-lead-repository.ts` — D1 CRUD без удаления.
- `ticketing-sites/drizzle/0004_private_leads.sql` — заявки и история контактов.
- `ticketing-sites/app/api/private-leads/route.ts` — защищённый server-to-server ingest.
- `ticketing-sites/app/api/admin/support/**`, `refunds/**`, `private-leads/**` — owner-only API.
- `ticketing-sites/app/components/admin/*` — отдельные вкладки и общий confirm dialog.
- `api/lead.js` — валидация, запись в canonical store и Telegram notification.
- `ticketing-sites/tools/reconcile.mjs`, `backup.mjs`, `restore-check.mjs` — операционные проверки.
- `ticketing-sites/docs/operations-runbook.md` — восстановление, возврат, поддержка, инцидент.

---

### Task 1: Зафиксировать pipeline частной заявки

**Files:**
- Create: `ticketing-sites/lib/private-lead-domain.ts`
- Create: `ticketing-sites/tests/private-lead-domain.test.mjs`

**Interfaces:**
- Produces: `PRIVATE_LEAD_STATUSES`
- Produces: `normalizePrivateLead(input: PrivateLeadInput): PrivateLead`
- Produces: `assertPrivateLeadTransition(current: string, next: string): void`
- Produces: `normalizeMoney(value: unknown): number | null`

- [ ] **Step 1: Написать падающий доменный тест**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { assertPrivateLeadTransition, normalizePrivateLead } from "../lib/private-lead-domain.ts";

test("normalizes an event lead and rejects missing contact", () => {
  assert.deepEqual(normalizePrivateLead({
    name: " Дмитрий ", phone: "+7 (999) 123-45-67", city: "Ярославль",
    eventType: "Свадьба", eventDate: "2026-09-12", guests: "80", source: "events-site",
  }), {
    name: "Дмитрий", phone: "+79991234567", email: "", city: "Ярославль",
    eventType: "Свадьба", eventDate: "2026-09-12", guests: 80, source: "events-site", note: "",
  });
  assert.throws(() => normalizePrivateLead({ name: "Дмитрий" }), /контакт/i);
});

test("pipeline cannot skip from new to completed", () => {
  assert.doesNotThrow(() => assertPrivateLeadTransition("new", "contacted"));
  assert.doesNotThrow(() => assertPrivateLeadTransition("contacted", "estimate"));
  assert.throws(() => assertPrivateLeadTransition("new", "completed"), /переход/i);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующим модулем.

- [ ] **Step 3: Реализовать домен**

Статусы: `new`, `contacted`, `estimate`, `contract`, `prepayment`, `event`, `completed`, `cancelled`. Разрешить последовательное движение вперёд, `cancelled` из любого незавершённого статуса и возврат `cancelled → contacted` только с административной причиной на repository layer.

- [ ] **Step 4: Проверить**

Run: `cd ticketing-sites && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ticketing-sites/lib/private-lead-domain.ts ticketing-sites/tests/private-lead-domain.test.mjs
git commit -m "feat: define private event lead pipeline"
```

### Task 2: Сохранить частные заявки и историю в D1

**Files:**
- Modify: `ticketing-sites/db/schema.ts`
- Create: `ticketing-sites/drizzle/0004_private_leads.sql`
- Create: `ticketing-sites/lib/private-lead-repository.ts`
- Create: `ticketing-sites/tests/private-lead-contract.test.mjs`

**Interfaces:**
- Produces tables: `private_leads`, `private_lead_events`.
- Produces: `createPrivateLead(input, ingestKey): Promise<PrivateLeadSummary>`
- Produces: `listPrivateLeads(filters): Promise<PrivateLeadSummary[]>`
- Produces: `updatePrivateLead(id, patch, reason): Promise<PrivateLeadDetail>`

- [ ] **Step 1: Написать падающий контракт**

```js
test("private leads persist finance fields and append-only history", async () => {
  const sql = await readFile(new URL("../drizzle/0004_private_leads.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE `private_leads`/);
  assert.match(sql, /quoted_price/);
  assert.match(sql, /prepayment/);
  assert.match(sql, /balance/);
  assert.match(sql, /CREATE TABLE `private_lead_events`/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующей миграцией.

- [ ] **Step 3: Создать таблицы**

`private_leads`: идентификатор, контакты, source, city, event_type, event_date, guests, selected_format, budget, quoted_price, prepayment, balance, status, next_action_at, note, created_at, updated_at.

`private_lead_events`: lead_id, actor, action, details_json, created_at. Индексы: status + event_date, next_action_at, phone, created_at.

- [ ] **Step 4: Реализовать repository**

Создание нормализует данные и добавляет `private_lead_events(action='lead.created')` одним batch. Обновление разрешает только перечисленные поля, проверяет pipeline, пересчитывает `balance = quotedPrice - prepayment` на сервере и всегда добавляет историю. Delete-функции нет.

- [ ] **Step 5: Проверить**

Run: `cd ticketing-sites && npm test`

Run: `cd ticketing-sites && npm run db:generate`

Expected: PASS без удаления старых таблиц.

- [ ] **Step 6: Commit**

```bash
git add ticketing-sites/db/schema.ts ticketing-sites/drizzle/0004_private_leads.sql ticketing-sites/lib/private-lead-repository.ts ticketing-sites/tests/private-lead-contract.test.mjs
git commit -m "feat: persist private event leads"
```

### Task 3: Сделать запись заявки первичной, Telegram — вторичным

**Files:**
- Create: `ticketing-sites/app/api/private-leads/route.ts`
- Modify: `api/lead.js`
- Modify: `server.js`
- Modify: `.env.example`
- Modify: `ticketing-sites/tests/private-lead-contract.test.mjs`

**Interfaces:**
- `POST ticketing /api/private-leads` requires `Authorization: Bearer <PRIVATE_LEADS_INGEST_SECRET>`.
- Root `POST /api/lead` persists first, then notifies Telegram.
- Success returns `{ ok: true, leadId, notification: "sent" | "failed" | "not_configured" }`.

- [ ] **Step 1: Написать API-контракт**

```js
test("lead ingest requires a server secret and root lead stores before Telegram", async () => {
  const route = await readFile(new URL("../app/api/private-leads/route.ts", import.meta.url), "utf8");
  assert.match(route, /PRIVATE_LEADS_INGEST_SECRET/);
  assert.match(route, /Authorization/);
  const root = await readFile(new URL("../../api/lead.js", import.meta.url), "utf8");
  assert.ok(root.indexOf("PRIVATE_LEADS_API_URL") < root.indexOf("api.telegram.org"));
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующим route.

- [ ] **Step 3: Реализовать server-to-server ingest**

Сравнить Bearer token constant-time, отказать `401` без него, нормализовать body и вызвать `createPrivateLead`. Возвращать только lead ID. Не разрешать CORS `*`.

- [ ] **Step 4: Перестроить root endpoint**

`api/lead.js` валидирует payload, отправляет server-to-server запрос в `PRIVATE_LEADS_API_URL` с секретом, получает `leadId`, затем независимо пытается уведомить Telegram. Если база недоступна — вернуть `503` и не сообщать пользователю об успешной заявке. Если Telegram недоступен после сохранения — вернуть `200` с `notification: "failed"` и сохранить предупреждение в лог без персональных данных.

- [ ] **Step 5: Синхронизировать локальный сервер**

Путь `/api/lead` в `server.js` использует тот же helper, а не отдельную Telegram-only реализацию. В `.env.example` перечислить имена переменных без значений.

- [ ] **Step 6: Проверить**

Run: `npm test`

Run: `cd ticketing-sites && npm test && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/lead.js server.js .env.example ticketing-sites/app/api/private-leads/route.ts ticketing-sites/tests/private-lead-contract.test.mjs
git commit -m "feat: make database canonical for private leads"
```

### Task 4: Добавить owner-only API поддержки, возвратов и заявок

**Files:**
- Create: `ticketing-sites/lib/customer-service-admin-repository.ts`
- Create: `ticketing-sites/app/api/admin/support/route.ts`
- Create: `ticketing-sites/app/api/admin/support/[id]/route.ts`
- Create: `ticketing-sites/app/api/admin/refunds/route.ts`
- Create: `ticketing-sites/app/api/admin/refunds/[id]/route.ts`
- Create: `ticketing-sites/app/api/admin/private-leads/route.ts`
- Create: `ticketing-sites/app/api/admin/private-leads/[id]/route.ts`
- Modify: `ticketing-sites/tests/admin-domain.test.mjs`
- Create: `ticketing-sites/tests/admin-customer-service-contract.test.mjs`

**Interfaces:**
- Every route consumes `withAdmin(request, handler, { mutate: true })` for mutations.
- PATCH support: `{ status, ownerNote, reason }`.
- PATCH refund: `{ status, ownerNote, reason }` with explicit transition rules.
- PATCH private lead: whitelisted pipeline/finance fields + `reason`.

- [ ] **Step 1: Расширить доменные тесты возврата**

```js
test("refund workflow cannot jump from requested to completed", () => {
  assert.doesNotThrow(() => assertRefundTransition("requested", "reviewing"));
  assert.doesNotThrow(() => assertRefundTransition("reviewing", "approved"));
  assert.doesNotThrow(() => assertRefundTransition("approved", "processing"));
  assert.doesNotThrow(() => assertRefundTransition("processing", "completed"));
  assert.throws(() => assertRefundTransition("requested", "completed"), /переход/i);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL до экспорта `assertRefundTransition`.

- [ ] **Step 3: Реализовать admin repository**

Списки фильтруются по status/query/date и ограничиваются 200 строками. Каждая PATCH-транзакция проверяет current status, нормализует причину, обновляет запись и добавляет audit event. `completed` возврата разрешён только при наличии `provider_refund_id` либо явного manual reference, сохранённого владельцем.

- [ ] **Step 4: Реализовать маршруты**

GET использует `withAdmin`; PATCH использует `withAdmin(..., { mutate: true })`. Все ответы `private, no-store`; ошибки не раскрывают SQL и stack.

- [ ] **Step 5: Проверить**

Run: `cd ticketing-sites && npm test && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ticketing-sites/lib ticketing-sites/app/api/admin ticketing-sites/tests
git commit -m "feat: add owner customer service API"
```

### Task 5: Разделить админку на безопасные предметные вкладки

**Files:**
- Modify: `ticketing-sites/app/components/admin-control-center.tsx`
- Create: `ticketing-sites/app/components/admin/admin-types.ts`
- Create: `ticketing-sites/app/components/admin/admin-api-client.ts`
- Create: `ticketing-sites/app/components/admin/admin-confirm-dialog.tsx`
- Create: `ticketing-sites/app/components/admin/today-tab.tsx`
- Create: `ticketing-sites/app/components/admin/support-tab.tsx`
- Create: `ticketing-sites/app/components/admin/refunds-tab.tsx`
- Create: `ticketing-sites/app/components/admin/private-leads-tab.tsx`
- Modify: `ticketing-sites/app/admin/admin.css`
- Create: `ticketing-sites/tests/admin-ui-contract.test.mjs`

**Interfaces:**
- `AdminConfirmDialog` props: `{ open, title, summary: string[], requireReason, confirmLabel, danger, busy, onCancel, onConfirm(reason: string) }`.
- `SupportTab`, `RefundsTab`, `PrivateLeadsTab` consume typed API client only.
- `Tab` adds `support | refunds | privateLeads`.

- [ ] **Step 1: Зафиксировать UI-контракт**

```js
test("owner admin contains service queues and no text KP placeholder", async () => {
  const center = await readFile(new URL("../app/components/admin-control-center.tsx", import.meta.url), "utf8");
  assert.match(center, /support/);
  assert.match(center, /refunds/);
  assert.match(center, /privateLeads/);
  assert.doesNotMatch(center, /admin-login__mark">KP</);
  const confirm = await readFile(new URL("../app/components/admin/admin-confirm-dialog.tsx", import.meta.url), "utf8");
  assert.match(confirm, /requireReason/);
  assert.match(confirm, /summary/);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующими компонентами.

- [ ] **Step 3: Вынести общие типы и API client**

Перенести `api<T>()`, money/date formatters и DTO в focused files. `admin-control-center.tsx` оставляет session, active tab, общую шапку и маршрутизацию вкладок.

- [ ] **Step 4: Добавить confirm dialog**

Заменить `window.prompt` и прямые опасные кнопки на диалог с точным объектом, текущим/новым статусом, суммой или числом мест, обязательной причиной и отдельным confirm. Первый клик только открывает диалог.

- [ ] **Step 5: Добавить три вкладки**

Support показывает SLA/возраст, категорию, заказ и статус. Refunds показывает сумму, билеты, причину, payment reference и допустимые действия. Private Leads показывает ближайший следующий шаг, дату события, pipeline, контакты и финансы. На mobile данные собираются в компактные cards, не горизонтальную таблицу.

- [ ] **Step 6: Исправить бренд**

Скопировать официальный square mark в `ticketing-sites/public/kostyuk-project-monogram-square-v1.png` и использовать его на login/header. Удалить текстовую заглушку `KP`, сохранив доступный alt.

- [ ] **Step 7: Проверить**

Run: `cd ticketing-sites && npm test && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ticketing-sites/app/components/admin ticketing-sites/app/components/admin-control-center.tsx ticketing-sites/app/admin/admin.css ticketing-sites/public ticketing-sites/tests/admin-ui-contract.test.mjs
git commit -m "feat: unify owner operations dashboard"
```

### Task 6: Добавить сверку, резервное копирование и проверку восстановления

**Files:**
- Create: `ticketing-sites/tools/reconcile.mjs`
- Create: `ticketing-sites/tools/backup.mjs`
- Create: `ticketing-sites/tools/restore-check.mjs`
- Modify: `ticketing-sites/package.json`
- Create: `ticketing-sites/tests/operations-contract.test.mjs`

**Interfaces:**
- `npm run ops:reconcile -- --db <path>` returns exit `0` only with no invariant violation.
- `npm run ops:backup -- --out <file>` creates timestamped SQL export without printing records.
- `npm run ops:restore-check -- --file <file>` imports into temporary local D1 and runs reconcile.

- [ ] **Step 1: Зафиксировать инварианты**

```js
test("operations scripts check sale invariants without destructive SQL", async () => {
  const source = await readFile(new URL("../tools/reconcile.mjs", import.meta.url), "utf8");
  for (const invariant of ["paid_without_tickets", "seat_double_assignment", "payment_amount_mismatch", "refund_without_reference"]) {
    assert.ok(source.includes(invariant));
  }
  assert.doesNotMatch(source, /DELETE FROM|DROP TABLE/i);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующим tool.

- [ ] **Step 3: Реализовать read-only сверку**

Проверки: два активных assignment на место; paid без ticket на каждый order item; payment amount не равен order amount; refunded с valid tickets/active seats; completed refund без reference; support/refund с отсутствующим order; prepayment больше quoted price. Выводить только IDs и тип нарушения, не контакты.

- [ ] **Step 4: Реализовать backup и restore-check**

Backup вызывает официальный Wrangler D1 export через `spawn` без shell interpolation. Restore-check создаёт временную локальную D1, импортирует SQL, запускает reconcile и удаляет только созданную временную директорию.

- [ ] **Step 5: Добавить scripts**

```json
"ops:reconcile": "node tools/reconcile.mjs",
"ops:backup": "node tools/backup.mjs",
"ops:restore-check": "node tools/restore-check.mjs"
```

- [ ] **Step 6: Проверить**

Run: `cd ticketing-sites && npm test && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ticketing-sites/tools ticketing-sites/package.json ticketing-sites/tests/operations-contract.test.mjs
git commit -m "ops: add ticketing reconciliation and backups"
```

### Task 7: Записать операционные регламенты

**Files:**
- Create: `ticketing-sites/docs/operations-runbook.md`
- Modify: `ticketing-sites/README.md`

**Interfaces:**
- Produces owner procedures for payment incident, refund, support, duplicate seat alert, backup and Touch ID recovery.

- [ ] **Step 1: Написать runbook**

Включить конкретные алгоритмы:

1. «Покупатель оплатил, заказа нет» — найти provider ID, не подтверждать вручную без сверки суммы, сохранить reference, выпустить tickets только допустимым переходом.
2. «Возврат» — проверить заказ/правила/билеты, approved → processing → provider/manual reference → completed, затем проверить освобождение мест и void tickets.
3. «Не пришёл билет» — идентификация по номеру + контакту, повторная отправка без выпуска второго ticket.
4. «Двойное место» — приостановить продажи performance, не удалять записи, экспортировать audit, связаться с покупателями.
5. «Touch ID потерян» — вход резервным паролем, отзыв passkey, привязка нового на production origin.
6. «Восстановление» — backup, restore-check, reconcile до переключения трафика.

- [ ] **Step 2: Обновить README**

Добавить ссылки на payment activation runbook и operations runbook, новые миграции, команды ops и честный статус live payment.

- [ ] **Step 3: Проверить отсутствие секретов**

Run: `rg -n "TerminalKey=|Password=|Bearer [A-Za-z0-9_-]{16,}" ticketing-sites/docs ticketing-sites/README.md`

Expected: нет результатов.

- [ ] **Step 4: Commit**

```bash
git add ticketing-sites/docs ticketing-sites/README.md
git commit -m "docs: add owner ticketing operations runbook"
```

### Task 8: Провести полный release gate

**Files:**
- Create: `docs/superpowers/walkthroughs/2026-08-14-unified-owner-admin-release-walkthrough.md`
- Modify only for verified defects: files from Tasks 1–7.

**Interfaces:**
- Consumes: Public Ecosystem plan, Ticketing Support/Refunds plan and this plan.
- Produces: GO/NO-GO matrix. Live payments remain NO-GO until the provider-specific gate passes.

- [ ] **Step 1: Проверить корневой сайт**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Проверить кассу**

Run: `cd ticketing-sites && npm test && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 3: Проверить покупательский сценарий локально**

Создать свежий заказ: выбрать продаваемые места → получить hold → оформить заказ → открыть защищённую страницу → отправить support → запросить refund только после тестового административного `paid`. Проверить, что fixtures зала не выбираются.

- [ ] **Step 4: Проверить владельца**

Войти паролем; привязать локальный passkey; выйти; войти через Touch ID. Проверить Today, Orders, Hall, Refunds, Support, Private Events, Scanner, Activity, Journal. На каждой опасной операции первый клик открывает резюме и не меняет данные.

- [ ] **Step 5: Проверить конкурентность**

В двух независимых browser contexts одновременно выбрать одно место. Только один hold получает `200`, второй получает `409` и понятное сообщение без потери остальных выбранных мест.

- [ ] **Step 6: Проверить responsive matrix**

Public: `320×720`, `390×844`, `768×1024`, `1440×900`, `1920×1080`. Admin: `390×844`, `768×1024`, `1440×900`. Зафиксировать overflow, safe area, focus и доступность кнопок.

- [ ] **Step 7: Проверить операции**

Выполнить backup локальной тестовой БД, restore-check и reconcile. Не использовать production DB в разрушительных тестах.

- [ ] **Step 8: Записать GO/NO-GO**

В walkthrough отдельно отметить: public design, seat reservation, order page, support, refund queue, private leads, Touch ID, backups. Live money movement отметить `NO-GO` до отдельной проверки официальной интеграции T-Банка, чеков и реального тестового возврата.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/walkthroughs/2026-08-14-unified-owner-admin-release-walkthrough.md
git commit -m "docs: record unified ecosystem release gate"
```
