# KOSTYUK PROJECT Unified Ecosystem Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Each linked implementation plan uses checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить подтверждённую единую экосистему KOSTYUK PROJECT без потери существующих материалов, без ложной боевой оплаты и без разрыва между публичными страницами, билетами и админкой.

**Architecture:** Работа разделена на три последовательных релиза. Публичный слой сначала закрепляет бренд и прямые маршруты. Затем билетное ядро получает безопасную страницу заказа, поддержку и запрос возврата. После этого единая owner-only админка принимает обращения и частные заявки, получает операционные проверки и проходит полный release gate.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js tests, React 19, TypeScript, vinext/Vite, Cloudflare Worker + D1, WebAuthn, Vercel routing.

## Execution Order

### Phase 0: Reversible Baseline

Before changing code:

- capture `git status --short` without staging or discarding the owner's existing work;
- record the current hashes of approved posters, hall plans, brand assets and background media;
- run the current root and `ticketing-sites` checks and record failures as baseline facts;
- capture desktop and mobile screenshots of `/`, the concert showcase, each show, `/events`, `/school` and `/admin`;
- save the result in `docs/superpowers/walkthroughs/2026-08-14-kostyuk-project-baseline.md` without secrets or personal customer data.

Exit criteria: every later visual or functional change can be compared with a named baseline and reverted without touching unrelated work.

### Phase 1: Unified Public Ecosystem

Execute: `docs/superpowers/plans/2026-08-14-unified-public-ecosystem.md`

Exit criteria:

- официальный переплетённый KP-знак используется в общей оболочке;
- `/`, `/shows`, `/shows/<slug>`, `/events`, `/school`, `/help`, `/admin` открываются напрямую;
- хаб не является обязательным шлюзом;
- основной CTA каждого направления доминирует, вторичные предложения компактны;
- старые ссылки сохраняют совместимость;
- мобильные контрольные ширины не имеют горизонтального скролла и крупной липкой шапки;
- Service Worker не удерживает старую белую или сломанную версию.

### Phase 2: Ticketing Support and Refunds

Execute: `docs/superpowers/plans/2026-08-14-ticketing-support-refunds.md`

Consumes from Phase 1:

- чистые маршруты и единая оболочка;
- `/help` как публичная точка помощи;
- утверждённые шоу, даты, цены и схемы залов без изменения.

Exit criteria:

- заказ читается только по `orderId + accessKey`;
- поддержка и запрос возврата сохраняются в D1 и видны по безопасному request key;
- клиентский запрос не меняет денежный статус;
- юридические страницы не содержат выдуманных реквизитов;
- payment init и webhook остаются fail-closed;
- live-оплата не может включиться без полного release-readiness gate.

### Phase 3: Unified Owner Admin and Release

Execute: `docs/superpowers/plans/2026-08-14-unified-owner-admin-release.md`

Consumes from Phase 2:

- таблицы и repository поддержки и возвратов;
- стабильные order/refund/support status contracts;
- fail-closed платёжную границу.

Exit criteria:

- владелец видит билеты, места, обращения, возвраты и частные заявки в одной owner-only панели;
- Touch ID/passkey проверен на production HTTPS origin, пароль остаётся резервным способом;
- опасные действия требуют резюме, причины и второго подтверждения;
- частная заявка сначала сохраняется в D1, затем уведомляет Telegram;
- backup, restore-check и reconcile проходят на тестовой базе;
- визуальная, доменная и E2E-матрица сохранена в walkthrough;
- live money movement остаётся `NO-GO`, пока отдельная интеграция Т-Банка, чеков, уведомления, webhook и реального тестового возврата не пройдёт собственный план и проверку.

## Cross-Phase Invariants

- Не изменять утверждённые афиши, фактические даты, цены и схемы залов без отдельного решения владельца.
- Не удалять исторические заказы, заявки, обращения, возвраты и audit events через UI.
- Не считать Telegram или email единственным источником истины.
- Не сообщать об успешной покупке, возврате или заявке до подтверждённой серверной записи.
- Не смешивать персональные данные с публичными API, логами, walkthrough или снимками тестов.
- Каждый релиз должен иметь отдельный commit, проверку и безопасный откат.

## Final Activation Boundary

Боевая продажа билетов активируется отдельным провайдер-специфичным планом только после получения утверждённых данных продавца и тестовых реквизитов. До этого экосистема может выпускаться как премиальная витрина, система выбора мест, создания неоплаченного заказа, поддержки, частных заявок и owner-only управления — без обещания онлайн-оплаты.
