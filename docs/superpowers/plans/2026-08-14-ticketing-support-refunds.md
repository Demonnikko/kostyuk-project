# Ticketing Support and Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить существующую билетную кассу безопасной страницей заказа, обращениями в поддержку и контролируемыми запросами на возврат без ложного обещания автоматического перевода денег.

**Architecture:** `ticketing-sites` остаётся транзакционным ядром на Cloudflare D1. Новые чистые доменные функции валидируют обращения и возвраты, репозиторий связывает их с заказом через `orderId + accessKey`, а API никогда не доверяет денежным статусам клиента. Провайдер оплаты остаётся закрытым feature gate до получения реальных реквизитов мерчанта, налоговых параметров, политики возврата и официальных тестовых ответов.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Vite 8, Cloudflare Worker + D1, Drizzle ORM, Node.js `>=22.13.0`, Node test runner.

## Global Constraints

- Существующие схемы залов и `buildSeatPlan()` не изменять.
- Заказ доступен покупателю только по паре `orderId + accessKey`.
- Один запрос клиента не меняет `orders.status` напрямую.
- Статусы обращения: `new`, `in_progress`, `waiting_customer`, `resolved`, `closed`.
- Статусы возврата: `requested`, `reviewing`, `approved`, `rejected`, `processing`, `completed`, `failed`.
- Денежный статус меняется только после подтверждённого ответа провайдера или действия владельца с обязательной причиной в разрешённом переходе.
- Не включать live-оплату без полной конфигурации T-Банка, чеков, callback-подписи и проверенного возврата.
- Все суммы вычисляются на сервере в целых рублях из `order_items.unit_price`.
- Публичные ответы не содержат `buyer_phone`, `buyer_email`, внутренних заметок и audit details.
- Любая мутация создаёт `audit_events`.

## File Structure

- `lib/support-domain.ts` — категории, статусы и чистая валидация обращения.
- `lib/refund-domain.ts` — статусы, допустимость и валидация запроса возврата.
- `lib/customer-service-repository.ts` — D1-запросы поддержки и возвратов.
- `db/schema.ts`, `drizzle/0003_customer_service.sql` — таблицы и индексы.
- `app/api/orders/[id]/support/route.ts` — создание обращения по защищённому заказу.
- `app/api/orders/[id]/refund/route.ts` — создание запроса возврата по защищённому заказу.
- `app/api/customer-requests/[key]/route.ts` — безопасное чтение статуса клиентом.
- `app/orders/[id]/page.tsx`, `app/components/order-status-client.tsx` — страница заказа.
- `app/legal/**`, `lib/release-readiness.ts` — юридическая навигация без выдуманных реквизитов и программный шлюз активации.
- `tests/support-refund-domain.test.mjs`, `tests/customer-service-contract.test.mjs` — доменная и исходная контрактная проверка.

---

### Task 1: Зафиксировать доменные правила поддержки и возвратов

**Files:**
- Create: `ticketing-sites/lib/support-domain.ts`
- Create: `ticketing-sites/lib/refund-domain.ts`
- Create: `ticketing-sites/tests/support-refund-domain.test.mjs`

**Interfaces:**
- Produces: `normalizeSupportRequest(input: SupportRequestInput): SupportRequest`
- Produces: `normalizeRefundRequest(input: RefundRequestInput): RefundRequest`
- Produces: `assertRefundRequestAllowed(orderStatus: string, existingActiveRequest: boolean): void`
- Produces: `SUPPORT_STATUSES`, `REFUND_REQUEST_STATUSES`.

- [ ] **Step 1: Написать падающие доменные тесты**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSupportRequest } from "../lib/support-domain.ts";
import { assertRefundRequestAllowed, normalizeRefundRequest } from "../lib/refund-domain.ts";

test("normalizes a support request without accepting arbitrary categories", () => {
  assert.deepEqual(
    normalizeSupportRequest({ category: "ticket", message: " Не пришёл билет на почту ", contact: "user@example.ru" }),
    { category: "ticket", message: "Не пришёл билет на почту", contact: "user@example.ru" },
  );
  assert.throws(() => normalizeSupportRequest({ category: "hack", message: "Помогите", contact: "x" }), /категор/i);
});

test("refund request is only available for paid orders and one active request", () => {
  assert.doesNotThrow(() => assertRefundRequestAllowed("paid", false));
  assert.throws(() => assertRefundRequestAllowed("pending_payment", false), /оплачен/i);
  assert.throws(() => assertRefundRequestAllowed("paid", true), /уже создан/i);
  assert.deepEqual(
    normalizeRefundRequest({ reason: " Не смогу прийти на спектакль ", ticketIds: ["T-2", "T-2", "T-1"] }),
    { reason: "Не смогу прийти на спектакль", ticketIds: ["T-1", "T-2"] },
  );
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующими доменными модулями.

- [ ] **Step 3: Реализовать чистые типы и валидацию**

```ts
export const SUPPORT_STATUSES = ["new", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export const SUPPORT_CATEGORIES = ["payment", "ticket", "refund", "access", "other"] as const;

export function normalizeSupportRequest(input: SupportRequestInput): SupportRequest {
  const category = String(input?.category ?? "");
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(category)) throw new Error("Выберите категорию обращения");
  const message = String(input?.message ?? "").trim().replace(/\s+/g, " ");
  if (message.length < 8 || message.length > 2000) throw new Error("Опишите проблему подробнее");
  const contact = String(input?.contact ?? "").trim().slice(0, 180);
  if (contact.length < 5) throw new Error("Укажите контакт для ответа");
  return { category: category as SupportCategory, message, contact };
}
```

```ts
export const REFUND_REQUEST_STATUSES = ["requested", "reviewing", "approved", "rejected", "processing", "completed", "failed"] as const;

export function assertRefundRequestAllowed(orderStatus: string, existingActiveRequest: boolean) {
  if (orderStatus !== "paid") throw new Error("Возврат доступен только для оплаченного заказа");
  if (existingActiveRequest) throw new Error("По заказу уже создан запрос на возврат");
}
```

- [ ] **Step 4: Запустить тесты**

Run: `cd ticketing-sites && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ticketing-sites/lib/support-domain.ts ticketing-sites/lib/refund-domain.ts ticketing-sites/tests/support-refund-domain.test.mjs
git commit -m "feat: define customer service lifecycle"
```

### Task 2: Добавить неизменяемые записи обращений и возвратов

**Files:**
- Modify: `ticketing-sites/db/schema.ts`
- Create: `ticketing-sites/drizzle/0003_customer_service.sql`
- Create: `ticketing-sites/tests/customer-service-contract.test.mjs`

**Interfaces:**
- Produces tables: `support_cases`, `refund_requests`.
- Produces indexes: `idx_support_status_created`, `idx_support_order`, `idx_refund_status_created`, `idx_refund_order`.
- Consumes: `orders.id`, `tickets.id` через JSON-массив подтверждённых ticket IDs.

- [ ] **Step 1: Написать падающий контракт миграции**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("customer service migration preserves requests and order links", async () => {
  const sql = await readFile(new URL("../drizzle/0003_customer_service.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE `support_cases`/);
  assert.match(sql, /CREATE TABLE `refund_requests`/);
  assert.match(sql, /FOREIGN KEY \(`order_id`\) REFERENCES `orders`/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с `ENOENT` для миграции.

- [ ] **Step 3: Добавить Drizzle-схему**

`support_cases`: `id`, `request_key`, `order_id`, `category`, `message`, `contact`, `status`, `owner_note`, `created_at`, `updated_at`, `resolved_at`.

`refund_requests`: `id`, `request_key`, `order_id`, `ticket_ids_json`, `amount`, `reason`, `status`, `owner_note`, `provider_refund_id`, `created_at`, `updated_at`, `completed_at`.

`request_key` имеет уникальный индекс и не совпадает с admin ID. `amount` обязателен и вычисляется до вставки из выбранных `order_items`.

- [ ] **Step 4: Написать SQL-миграцию**

Создать обе таблицы, внешние ключи без cascade deletion и четыре индекса. Не менять `0000`–`0002` и их журнал.

- [ ] **Step 5: Проверить**

Run: `cd ticketing-sites && npm test`

Run: `cd ticketing-sites && npm run db:generate`

Expected: тест проходит; Drizzle не создаёт незапланированного удаления существующих таблиц.

- [ ] **Step 6: Commit**

```bash
git add ticketing-sites/db/schema.ts ticketing-sites/drizzle/0003_customer_service.sql ticketing-sites/tests/customer-service-contract.test.mjs
git commit -m "feat: persist support and refund requests"
```

### Task 3: Реализовать защищённый customer-service repository

**Files:**
- Create: `ticketing-sites/lib/customer-service-repository.ts`
- Modify: `ticketing-sites/lib/ticketing-repository.ts`
- Modify: `ticketing-sites/tests/customer-service-contract.test.mjs`

**Interfaces:**
- Produces: `createSupportCase(input: { orderId: string; accessKey: string; category: unknown; message: unknown; contact: unknown }): Promise<PublicSupportCase>`
- Produces: `createRefundRequest(input: { orderId: string; accessKey: string; reason: unknown; ticketIds: unknown }): Promise<PublicRefundRequest>`
- Produces: `getCustomerRequest(requestKey: string): Promise<PublicCustomerRequest>`
- Consumes: `getOrder(orderId, accessKey)` and D1 binding `DB`.

- [ ] **Step 1: Добавить исходный контракт репозитория**

```js
test("repository requires access key and audits both request types", async () => {
  const source = await readFile(new URL("../lib/customer-service-repository.ts", import.meta.url), "utf8");
  assert.match(source, /getOrder\(orderId, accessKey\)/);
  assert.match(source, /support\.created/);
  assert.match(source, /refund\.requested/);
  assert.match(source, /SELECT[\s\S]+unit_price/);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующим repository.

- [ ] **Step 3: Реализовать создание обращения**

Сначала вызвать `getOrder(orderId, accessKey)`, затем `normalizeSupportRequest`, создать `KP-SUP-*` и случайный `requestKey`, вставить `support_cases` и `audit_events` одним `db.batch()`. В публичный ответ вернуть только номер, категорию, статус и даты.

- [ ] **Step 4: Реализовать создание возврата**

Проверить защищённый заказ, статус `paid`, отсутствие активного запроса и принадлежность всех `ticketIds` заказу. Получить сумму `SUM(order_items.unit_price)` только для выбранных действующих билетов. Создать `KP-REF-*`, `requestKey`, `refund_requests` и audit в одном batch. Не менять `orders.status`.

- [ ] **Step 5: Реализовать безопасное чтение**

`getCustomerRequest(requestKey)` ищет поддержку и возврат только по точному случайному ключу, возвращает тип, публичный номер, статус и даты; не возвращает owner note, buyer contacts или provider IDs.

- [ ] **Step 6: Проверить**

Run: `cd ticketing-sites && npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ticketing-sites/lib/customer-service-repository.ts ticketing-sites/lib/ticketing-repository.ts ticketing-sites/tests/customer-service-contract.test.mjs
git commit -m "feat: add protected customer request repository"
```

### Task 4: Открыть минимальные публичные API

**Files:**
- Create: `ticketing-sites/app/api/orders/[id]/support/route.ts`
- Create: `ticketing-sites/app/api/orders/[id]/refund/route.ts`
- Create: `ticketing-sites/app/api/customer-requests/[key]/route.ts`
- Modify: `ticketing-sites/tests/customer-service-contract.test.mjs`

**Interfaces:**
- `POST /api/orders/:id/support` body `{ accessKey, category, message, contact }`.
- `POST /api/orders/:id/refund` body `{ accessKey, reason, ticketIds }`.
- `GET /api/customer-requests/:key` returns public request status.

- [ ] **Step 1: Добавить контракт маршрутов**

```js
test("public request routes expose POST, POST and GET only", async () => {
  const support = await readFile(new URL("../app/api/orders/[id]/support/route.ts", import.meta.url), "utf8");
  const refund = await readFile(new URL("../app/api/orders/[id]/refund/route.ts", import.meta.url), "utf8");
  const status = await readFile(new URL("../app/api/customer-requests/[key]/route.ts", import.meta.url), "utf8");
  assert.match(support, /export async function POST/);
  assert.match(refund, /export async function POST/);
  assert.match(status, /export async function GET/);
  assert.doesNotMatch(`${support}${refund}`, /status\s*:\s*body\./);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующими route files.

- [ ] **Step 3: Реализовать стандартизированные ответы**

Успех: `{ ok: true, request }` с `201`. Ошибка валидации/доступа: `{ ok: false, error: string }` с `400` или `404`, без stack trace. Добавить `Cache-Control: no-store` ко всем трём ответам.

- [ ] **Step 4: Проверить**

Run: `cd ticketing-sites && npm test`

Run: `cd ticketing-sites && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ticketing-sites/app/api ticketing-sites/tests/customer-service-contract.test.mjs
git commit -m "feat: expose customer support and refund API"
```

### Task 5: Добавить покупателю страницу заказа и понятную помощь

**Files:**
- Create: `ticketing-sites/app/orders/[id]/page.tsx`
- Create: `ticketing-sites/app/components/order-status-client.tsx`
- Modify: `ticketing-sites/app/components/ticket-dialog.tsx`
- Modify: `ticketing-sites/app/globals.css`
- Modify: `ticketing-sites/tests/customer-service-contract.test.mjs`

**Interfaces:**
- Consumes: `GET /api/orders/:id?accessKey=...`, support/refund endpoints.
- Produces: URL `/orders/:id?k=:accessKey` and клиентские формы без передачи статуса заказа.

- [ ] **Step 1: Зафиксировать UI-контракт**

```js
test("order page offers help and a refund request without promising instant money", async () => {
  const source = await readFile(new URL("../app/components/order-status-client.tsx", import.meta.url), "utf8");
  assert.match(source, /Помощь с заказом/);
  assert.match(source, /Запросить возврат/);
  assert.match(source, /Запрос принят|рассмотр/);
  assert.doesNotMatch(source, /деньги уже возвращены/i);
});
```

- [ ] **Step 2: Подтвердить падение**

Run: `cd ticketing-sites && npm test`

Expected: FAIL с отсутствующим компонентом.

- [ ] **Step 3: Создать страницу**

Страница получает `id` и query `k`, затем клиент загружает защищённый заказ. Показывает шоу, дату, время, площадку, места, количество, сумму и статус. При отсутствии ключа или 404 — нейтральное сообщение и ссылка поддержки без раскрытия существования заказа.

- [ ] **Step 4: Добавить две отдельные формы**

Support: категория, сообщение, контакт. Refund: только для `paid`, причина и чекбоксы действующих билетов. После успешной отправки показывать номер и ссылку статуса запроса; блокировать повторную отправку во время запроса.

- [ ] **Step 5: Обновить checkout**

После создания заказа `ticket-dialog.tsx` показывает кнопку «Открыть заказ» на `/orders/${order.id}?k=${accessKey}`. При выключенной оплате явно пишет «Онлайн-оплата пока не подключена; заказ не считается оплаченным».

- [ ] **Step 6: Проверить**

Run: `cd ticketing-sites && npm test`

Run: `cd ticketing-sites && npm run lint`

Run: `cd ticketing-sites && npm run build`

Expected: PASS; build не содержит клиентского импорта D1.

- [ ] **Step 7: Commit**

```bash
git add ticketing-sites/app/orders ticketing-sites/app/components/order-status-client.tsx ticketing-sites/app/components/ticket-dialog.tsx ticketing-sites/app/globals.css ticketing-sites/tests/customer-service-contract.test.mjs
git commit -m "feat: add protected buyer order page"
```

### Task 6: Закрыть платёжную границу и проверить отказоустойчивость

**Files:**
- Modify: `ticketing-sites/lib/payment-provider.ts`
- Modify: `ticketing-sites/app/api/payments/init/route.ts`
- Create: `ticketing-sites/app/api/payments/webhook/route.ts`
- Create: `ticketing-sites/app/legal/page.tsx`
- Create: `ticketing-sites/app/legal/privacy/page.tsx`
- Create: `ticketing-sites/app/legal/tickets/page.tsx`
- Create: `ticketing-sites/app/legal/refunds/page.tsx`
- Create: `ticketing-sites/lib/release-readiness.ts`
- Modify: `ticketing-sites/tests/ticketing-contract.test.mjs`
- Create: `ticketing-sites/tests/release-readiness.test.mjs`
- Create: `ticketing-sites/docs/payment-activation-runbook.md`

**Interfaces:**
- Produces: `PaymentProvider` interface with `createPayment()` and `refundPayment()`.
- Produces: fail-closed webhook route.
- Produces: юридические страницы и программный запрет боевой оплаты при неполной конфигурации продавца.
- Consumes: `getPaymentAvailability(env)`.

- [ ] **Step 1: Написать fail-closed тест**

```js
test("payment boundary cannot activate from partial configuration", () => {
  const env = {
    TBANK_TERMINAL_KEY: "key",
    TBANK_TERMINAL_PASSWORD: "secret",
    TBANK_TAXATION: "usn_income",
    TBANK_VAT: "none",
  };
  assert.equal(getPaymentAvailability(env).enabled, false);
});
```

- [ ] **Step 2: Подтвердить текущее поведение**

Run: `cd ticketing-sites && npm test`

Expected: PASS; этот шаг фиксирует защитную границу до реальных реквизитов.

- [ ] **Step 3: Ввести provider interface без фиктивной реализации**

```ts
export interface PaymentProvider {
  createPayment(input: { orderId: string; amount: number; returnUrl: string }): Promise<{ providerPaymentId: string; paymentUrl: string }>;
  refundPayment(input: { orderId: string; providerPaymentId: string; amount: number; idempotencyKey: string }): Promise<{ providerRefundId: string; status: "processing" | "completed" }>;
}
```

`getPaymentProvider()` возвращает провайдер только при полной конфигурации и отдельном `TBANK_LIVE_ENABLED=true`; иначе бросает контролируемую ошибку `merchant_configuration_required`. Не реализовывать имитацию успешной оплаты.

- [ ] **Step 4: Сделать webhook fail-closed**

До реализации официальной проверки токена маршрут возвращает `503 { ok: false, error: "payment_provider_not_activated" }`. Он не меняет заказ и записывает только техническое предупреждение без секретов.

- [ ] **Step 5: Добавить release-readiness gate**

`assertLivePaymentsReady(env)` требует не пустые `PUBLIC_SELLER_LEGAL_NAME`, `PUBLIC_SELLER_TAX_ID`, `PUBLIC_SUPPORT_CONTACT`, `PUBLIC_OFFER_VERSION`, `PUBLIC_PRIVACY_VERSION`, `TBANK_TERMINAL_KEY`, `TBANK_TERMINAL_PASSWORD`, `TBANK_TAXATION`, `TBANK_VAT`, `TICKET_EMAIL_FROM` и `PUBLIC_HTTPS_ORIGIN`. Тест проверяет, что отсутствие любого поля оставляет `TBANK_LIVE_ENABLED=false` и не позволяет init route создать платёж. Секретные значения никогда не передаются в страницы или JSON.

- [ ] **Step 6: Создать юридическую навигацию без выдуманных фактов**

Страницы показывают только утверждённые владельцем версии политики, оферты и правил возврата из серверной конфигурации. При отсутствии утверждённых реквизитов они показывают нейтральное «Документы готовятся; продажа билетов онлайн не активирована», а release-readiness gate сохраняет live-оплату выключенной. В подвале билетных страниц всегда доступны `/legal`, `/legal/privacy`, `/legal/tickets`, `/legal/refunds` и `/help`.

- [ ] **Step 7: Записать точный runbook активации**

Перечислить обязательные входные данные: TerminalKey, Password, taxation, VAT, публичный HTTPS origin, политика полного/частичного возврата, email отправителя, формат чека, тестовый мерчант. Указать, что следующий провайдер-специфичный план начинается с официальной документации Т-Банка и тестового терминала.

- [ ] **Step 8: Проверить**

Run: `cd ticketing-sites && npm test && npm run lint && npm run build`

Expected: PASS; `/api/payments/webhook` не способен отметить заказ оплаченным.

- [ ] **Step 9: Commit**

```bash
git add ticketing-sites/lib/payment-provider.ts ticketing-sites/lib/release-readiness.ts ticketing-sites/app/api/payments ticketing-sites/app/legal ticketing-sites/tests/ticketing-contract.test.mjs ticketing-sites/tests/release-readiness.test.mjs ticketing-sites/docs/payment-activation-runbook.md
git commit -m "security: keep payment lifecycle fail closed"
```
