# Concert Ecosystem Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the premium KOSTYUK PROJECT concert showcase and individual show pages, while keeping the new seat-selection checkout as a secondary modal flow that sells numbered seats only.

**Architecture:** The public Next.js entry becomes a concert showcase backed by one typed show-content catalog. Dynamic `/shows/[slug]` pages render truthful editorial content and open a client-side ticket dialog for the matching performance. The existing D1 reservation API remains authoritative; decorative hall zones move from seat inventory into non-interactive SVG fixtures.

**Tech Stack:** Next.js-compatible Vinext, React 19, TypeScript, Cloudflare D1 repository layer, Node test runner, CSS.

## Global Constraints

- Preserve the journey: showcase -> show detail -> ticket dialog -> numbered seat -> buyer details -> order.
- Only numbered seats may be reserved, priced, selected, or submitted to the order API.
- Sofas, bar, and LAMPA are decorative hall fixtures only.
- Do not invent trailers, reviews, dates, prices, or venues; reuse verified content from `concerts/` and `lib/catalog.ts`.
- Huligan and Matvey have no trailer; Secret may use its two existing VK videos.
- Payment remains visibly unavailable until the payment provider configuration is complete.
- Use one KOSTYUK PROJECT visual system: black, warm gold, ivory, shared buttons, radii, borders, typography, header, footer, and ecosystem links.
- On mobile, the ticket dialog is full-screen, cards stay compact, the hall can pan horizontally, and the document itself has no horizontal overflow.
- Preserve unrelated changes in the dirty worktree.

---

### Task 1: Make Special Hall Zones Non-Sellable

**Files:**
- Modify: `ticketing-sites/tests/ticketing-contract.test.mjs`
- Modify: `ticketing-sites/lib/catalog.ts`

**Interfaces:**
- Consumes: `buildSeatPlan(performanceId: string): SeatPlanItem[]` and `buildHallFixtures(performanceId: string): HallFixture[]`.
- Produces: seat plans containing numbered `kind: "seat"` items only, plus fixtures with `kind: "sofa" | "bar" | "lampa"`.

- [ ] **Step 1: Write the failing contract test**

  Assert exact sellable counts `56`, `106`, and `92`; assert every returned seat has `kind === "seat"` and `seatNumber > 0`; assert each performance exposes its special zones through `buildHallFixtures`.

- [ ] **Step 2: Run the contract test and verify RED**

  Run: `cd ticketing-sites && npm test -- tests/ticketing-contract.test.mjs`

  Expected: FAIL because sofa, bar, and LAMPA still exist in seat inventory and fixture kinds do not yet support all decorative zones.

- [ ] **Step 3: Move special zones into fixtures**

  Remove `SOFA-L`, `SOFA-R`, `BAR`, and `LAMPA` from all seat builders. Extend `HallFixture.kind` with `sofa` and `lampa`, and add spatially equivalent fixture records to the matching halls.

- [ ] **Step 4: Run all domain and contract tests and verify GREEN**

  Run: `cd ticketing-sites && npm test`

  Expected: all tests pass; a special-zone code cannot be found by the repository because it is not in the seeded inventory.

---

### Task 2: Create One Editorial Show Catalog

**Files:**
- Create: `ticketing-sites/lib/show-content.ts`
- Create: `ticketing-sites/tests/show-content.test.mjs`

**Interfaces:**
- Consumes: `CATALOG` from `lib/catalog.ts`.
- Produces: `SHOW_CONTENT`, `ShowContent`, and `getShowContent(slug: string)` with hero, about, audience, feeling, visit, feature, media, and ecosystem data.

- [ ] **Step 1: Write a failing show-content test**

  Assert that all `CATALOG` slugs have editorial content, only Secret contains video embeds, every item maps to a real performance, and no media URL is empty.

- [ ] **Step 2: Run the test and verify RED**

  Run: `cd ticketing-sites && npm test -- tests/show-content.test.mjs`

  Expected: FAIL because `lib/show-content.ts` does not exist.

- [ ] **Step 3: Add typed, verified content**

  Transcribe the existing Huligan, Secret, and Matvey copy from `concerts/*/index.html`; map poster paths and performance IDs from `CATALOG`; add only Secret's existing VK review and promo URLs.

- [ ] **Step 4: Run the test and verify GREEN**

  Run: `cd ticketing-sites && npm test -- tests/show-content.test.mjs`

  Expected: PASS for all three complete show records and truthful media availability.

---

### Task 3: Restore the Concert Showcase

**Files:**
- Create: `ticketing-sites/app/components/ecosystem-header.tsx`
- Create: `ticketing-sites/app/components/ecosystem-footer.tsx`
- Create: `ticketing-sites/app/components/concert-showcase.tsx`
- Modify: `ticketing-sites/app/page.tsx`
- Modify: `ticketing-sites/app/layout.tsx`

**Interfaces:**
- Consumes: `SHOW_CONTENT` and catalog performance metadata.
- Produces: root route `/` with three linked poster cards and immediate ecosystem crosslinks to `/events/` and `/school/`.

- [ ] **Step 1: Add a failing route/content contract**

  Extend `tests/show-content.test.mjs` to assert that each showcase URL is `/shows/<slug>` and ecosystem destinations are the real relative routes.

- [ ] **Step 2: Run the test and verify RED**

  Run: `cd ticketing-sites && npm test -- tests/show-content.test.mjs`

  Expected: FAIL until showcase hrefs are represented in the catalog.

- [ ] **Step 3: Implement the showcase and shared chrome**

  Replace `TicketShop` on `/` with a premium editorial hero, compact poster rail/grid, show metadata and direct card links. Place the two ecosystem links immediately after the cards, and use one restrained logo in the shared header.

- [ ] **Step 4: Run the test and build**

  Run: `cd ticketing-sites && npm test && npm run build`

  Expected: tests pass and the root route compiles without the checkout being rendered eagerly.

---

### Task 4: Restore Individual Show Pages

**Files:**
- Create: `ticketing-sites/app/components/show-detail.tsx`
- Create: `ticketing-sites/app/components/show-page-client.tsx`
- Create: `ticketing-sites/app/shows/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getShowContent(slug)` and `TicketDialog` from Task 5.
- Produces: static show routes for Huligan, Secret, and Matvey; each page invokes `onBuy()` without embedding the hall in its editorial layout.

- [ ] **Step 1: Add a failing page-data test**

  Assert that the public detail model contains a title, promise, date, venue, age, duration, two about paragraphs, audience text, feeling text, visit guidance, and at least three features for every slug.

- [ ] **Step 2: Run the test and verify RED**

  Run: `cd ticketing-sites && npm test -- tests/show-content.test.mjs`

  Expected: FAIL for any incomplete detail section.

- [ ] **Step 3: Implement dynamic premium detail pages**

  Add poster-led hero, show story, quote, audience, feeling, visit guidance, features, conditional real media, repeated buy actions, and bottom ecosystem transitions. Use `notFound()` for unknown slugs and generate all three static params.

- [ ] **Step 4: Run tests and build**

  Run: `cd ticketing-sites && npm test && npm run build`

  Expected: all three `/shows/<slug>` routes compile and no empty video/review placeholder is rendered.

---

### Task 5: Isolate the Ticket Dialog from Editorial Pages

**Files:**
- Create: `ticketing-sites/app/components/ticket-dialog.tsx`
- Create: `ticketing-sites/app/components/hall-map.tsx`
- Modify: `ticketing-sites/app/ticket-shop.tsx`
- Modify: `ticketing-sites/app/components/show-page-client.tsx`

**Interfaces:**
- Produces: `TicketDialog({ open, onClose, performanceId, showTitle })` and `HallMap({ seats, fixtures, selectedCodes, onToggle, expanded, onExpandedChange })`.
- Consumes: existing `/api/catalog`, `/api/seats`, `/api/holds`, and `/api/orders` contracts.

- [ ] **Step 1: Add a failing selection-domain assertion**

  Extend the contract test so the selectable list is derived solely from catalog seat inventory and contains no special fixture codes.

- [ ] **Step 2: Run the test and verify RED if any special item remains**

  Run: `cd ticketing-sites && npm test -- tests/ticketing-contract.test.mjs`

  Expected: PASS only after Task 1; this is the regression gate for the UI extraction.

- [ ] **Step 3: Extract the existing working checkout**

  Move hall SVG, availability loading, seat selection, hold refresh/release, buyer fields, order summary, and disabled payment state into the dialog. Fix the performance from the current show page rather than asking the buyer to choose a show again. Add Escape, close button, focus target, scroll lock, and accessible dialog semantics.

- [ ] **Step 4: Verify reservation and release through the API**

  Start the local server, reserve a numbered code such as `T01-03`, verify a second hold conflicts, release it, and verify `SOFA-L` is rejected.

- [ ] **Step 5: Run tests and build**

  Run: `cd ticketing-sites && npm test && npm run build`

  Expected: checkout compiles only as an invoked dialog and all repository invariants remain green.

---

### Task 6: Apply the Unified Premium Responsive System

**Files:**
- Modify: `ticketing-sites/app/globals.css`

**Interfaces:**
- Consumes: component class names from Tasks 3-5.
- Produces: one responsive KOSTYUK PROJECT visual system for showcase, details, media, ecosystem links, dialog, hall, order summary, and forms.

- [ ] **Step 1: Define shared design tokens**

  Add tokens for black surfaces, ivory text, muted text, warm gold, show accents, border alpha, radii, serif/sans stacks, shadows, spacing, and focus rings.

- [ ] **Step 2: Style desktop hierarchy**

  Keep editorial content centered and readable, posters dominant, gold restrained, ecosystem cards secondary, and the ticket dialog large but clearly modal.

- [ ] **Step 3: Style mobile hierarchy**

  At narrow widths, use a compact horizontal poster rail with the next card visible, collapse detail grids, make the dialog full-screen, keep controls at least 44px tall, and preserve horizontal hall panning inside its own viewport.

- [ ] **Step 4: Add accessibility and motion fallbacks**

  Add `:focus-visible`, sufficient color contrast, `prefers-reduced-motion`, non-color selected/occupied states, and `overflow-x: clip` only at the document layer while leaving the hall viewport scrollable.

- [ ] **Step 5: Run build and static checks**

  Run: `cd ticketing-sites && npm run build`

  Expected: CSS and all routes compile with no TypeScript or bundling errors.

---

### Task 7: Verify the Complete Release Candidate

**Files:**
- Modify: `ticketing-sites/tests/ticketing-contract.test.mjs`
- Modify: `ticketing-sites/tests/show-content.test.mjs`

**Interfaces:**
- Verifies: catalog truth, editorial completeness, numbered-seat-only inventory, reservation conflict, release, server totals, and disabled payment boundary.

- [ ] **Step 1: Run the full automated suite**

  Run: `cd ticketing-sites && npm test`

  Expected: all tests pass with no skipped checks.

- [ ] **Step 2: Run the production build**

  Run: `cd ticketing-sites && npm run build`

  Expected: successful production build for root, three show pages, and all API routes.

- [ ] **Step 3: Verify rendered route content without browser automation**

  Fetch `/`, `/shows/huligan`, `/shows/secret`, and `/shows/matvey` from the local server. Confirm HTTP 200, unique titles, correct dates, ecosystem links, and absence of hall markup before opening the ticket dialog.

- [ ] **Step 4: Verify the live API invariants**

  Confirm catalog counts `56/106/92`, successful hold and release for a numbered seat, conflict for a duplicate hold, rejection for `SOFA-L`, and provider-disabled payment copy.

- [ ] **Step 5: Review the diff**

  Run: `git diff --check` and inspect only the intended `ticketing-sites/` and plan/spec changes. Confirm no unrelated dirty file was overwritten.

