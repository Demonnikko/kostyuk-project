# VK Mini App "Авторские шоу" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new VK Mini App `54751520` that sells tickets for Secret, HULIgan, and Save Matvey through the existing inventory, payment, ticket, admin, and refund system.

**Architecture:** Create an isolated static client under `vk-mini-app/` with a shared API adapter and three show configurations. Add a narrowly scoped server endpoint that validates VK launch parameters and reports connectivity; existing booking endpoints remain the source of truth and are changed only where a validated VK context or source marker is required.

**Tech Stack:** HTML, CSS, browser JavaScript modules, VK Bridge, Node.js `node:test`, existing Node HTTP server and Firebase/T-Bank endpoints.

**Spec:** `docs/superpowers/specs/2026-09-03-vk-mini-app-author-shows-design.md`

## Global Constraints

- Build application `54751520` from scratch; do not copy legacy Mini App code.
- Keep the existing website and legacy Mini App operational until all release gates pass.
- Reuse current Firebase inventory, T-Bank flow, tickets, QR codes, admin, and refunds.
- Do not expose VK, Firebase, T-Bank, or admin secrets in client files.
- Do not claim whitelist resilience until tested on a real restricted mobile network.

---

### Task 1: Isolated Mini App Shell And Routing

**Files:**
- Create: `vk-mini-app/index.html`
- Create: `vk-mini-app/styles.css`
- Create: `vk-mini-app/app.js`
- Create: `vk-mini-app/lib/router.js`
- Create: `vk-mini-app/lib/shows.js`
- Test: `tests/vk-mini-app.test.mjs`

**Interfaces:**
- Produces: `parseLaunchRoute(locationLike) -> { show: "secret"|"huligan"|"matvey"|null }`
- Produces: `SHOWS`, an immutable three-show configuration map.

- [ ] Write a failing test asserting that the new directory exists, contains no legacy app ID, lists exactly three shows, and resolves `show=secret`, `show=huligan`, and `show=matvey`.
- [ ] Run `node --test tests/vk-mini-app.test.mjs` and verify failure because the files and exports do not exist.
- [ ] Implement the minimal catalog, direct-show routing, VK safe-area layout, loading state, and unavailable state.
- [ ] Run `node --test tests/vk-mini-app.test.mjs` and verify all Task 1 assertions pass.
- [ ] Commit only Task 1 files with `feat: add VK author shows app shell`.

### Task 2: Connectivity Probe And VK Launch Validation

**Files:**
- Create: `shared/vkLaunchParams.js`
- Create: `api/_endpoints/vk-mini-app.js`
- Create: `api/vk-mini-app.js`
- Create: `vk-mini-app/lib/api.js`
- Modify: `api/[endpoint].js`
- Test: `tests/vk-mini-app-auth.test.mjs`

**Interfaces:**
- Produces: `verifyVkLaunchParams(searchParams, secret, maxAgeSeconds) -> { ok, userId, appId, reason }`.
- Produces: `GET /api/vk-mini-app?action=health`, returning public service health without secrets.
- Produces: `POST /api/vk-mini-app` with `{ action: "session", launchParams }`, returning a short-lived signed server session only for app ID `54751520`.
- Produces: `createApiClient({ baseUrl, sessionToken })` with `health()`, `getJson()`, and `postJson()`.

- [ ] Write failing tests for valid HMAC launch signatures, tampered signatures, wrong app IDs, expired launches, and health response shape.
- [ ] Run `node --test tests/vk-mini-app-auth.test.mjs` and verify failures are caused by missing implementation.
- [ ] Implement signature verification with `crypto.createHmac`, constant-time comparison, application ID enforcement, and bounded launch age.
- [ ] Implement the health/session endpoint and API client timeout/error normalization.
- [ ] Run the focused auth tests and the existing security tests.
- [ ] Commit only Task 2 files with `feat: validate VK mini app sessions`.

### Task 3: Read-Only Catalog, Dates, And Seat Maps

**Files:**
- Create: `vk-mini-app/lib/booking.js`
- Create: `vk-mini-app/components/catalog.js`
- Create: `vk-mini-app/components/seat-map.js`
- Modify: `vk-mini-app/app.js`
- Modify: `vk-mini-app/styles.css`
- Test: `tests/vk-mini-app-booking.test.mjs`

**Interfaces:**
- Produces: `loadShowState(showId, api) -> { config, seats, unavailableReason }`.
- Produces: `normalizeSeat(showId, rawSeat) -> { key, label, price, status, zone }`.
- Consumes existing public reads from `/api/seats`, `/api/huligan`, and `/api/matvey-seats`.

- [ ] Write failing tests for all three endpoint mappings, normalized color zones, occupied-seat states, and network-unavailable output.
- [ ] Run the focused test and verify expected failures.
- [ ] Implement read-only show/date/seat loading and accessible seat selection views without mutation.
- [ ] Verify locally at 390px and 1440px that all three shows open and seat controls do not overlap.
- [ ] Run focused and existing concert layout tests.
- [ ] Commit only Task 3 files with `feat: show live seats in VK mini app`.

### Task 4: Reservation, Checkout, And T-Bank Payment

**Files:**
- Modify: `vk-mini-app/lib/booking.js`
- Create: `vk-mini-app/components/checkout.js`
- Create: `vk-mini-app/components/payment.js`
- Modify: `vk-mini-app/app.js`
- Modify: `api/_endpoints/book.js`
- Modify: `api/_endpoints/huligan.js`
- Modify: `api/_endpoints/matvey.js`
- Test: `tests/vk-mini-app-checkout.test.mjs`

**Interfaces:**
- Produces: `reserveSeats(showId, selection, contact, session, api)` using the existing show-specific payload contracts.
- Produces: `startPayment(showId, booking, session, api) -> { paymentUrl }`.
- Adds `source: "vk-mini-app"` and validated `vkUserId` to existing bookings without creating new storage nodes.

- [ ] Write failing contract tests for three show payloads, server rejection without a valid VK session, source persistence, and unchanged web payload acceptance.
- [ ] Run focused tests and verify they fail for the missing Mini App checkout adapter.
- [ ] Implement reservation and checkout adapters using the current show-specific APIs.
- [ ] Open T-Bank through VK Bridge external navigation, persist pending booking state locally, and restore it after return.
- [ ] Run focused checkout, seat-claim security, concert flow, and admin security tests.
- [ ] Commit only Task 4 files with `feat: connect VK mini app checkout`.

### Task 5: Tickets, Admin Compatibility, And Release Verification

**Files:**
- Create: `vk-mini-app/components/ticket.js`
- Modify: `vk-mini-app/app.js`
- Modify: `admin/index.html` only if the existing source display cannot render `vk-mini-app`.
- Modify: `package.json`
- Test: `tests/vk-mini-app-e2e.test.mjs`
- Create: `docs/vk-mini-app-release-checklist.md`

**Interfaces:**
- Produces: restored ticket view using the existing ticket-link endpoints and tokenized ticket URLs.
- Produces: `npm run test:vk-mini-app` for all Mini App tests.

- [ ] Write failing tests for paid-ticket restoration, all three ticket URL types, source visibility in admin data, and no legacy app ID in new client files.
- [ ] Run the focused tests and verify expected failures.
- [ ] Implement ticket restoration and the smallest necessary admin source label change.
- [ ] Add the focused test script and a release checklist covering VK iOS, VK Android, desktop, Wi-Fi, normal mobile data, active whitelist, payment, QR scan, cancellation, and refund.
- [ ] Run `npm run test:vk-mini-app` and `npm test`.
- [ ] Start the local server and verify catalog, all show routes, unavailable state, responsive geometry, and nonblank rendering with browser screenshots.
- [ ] Deploy only after local verification, set VK placement URLs, then run the real-device release checklist before enabling the community launch button.
- [ ] Commit Task 5 with `feat: complete VK author shows purchase flow`.

