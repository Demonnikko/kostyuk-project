# VK Mini App "Авторские шоу": design

## Goal

Create a new VK Mini App for application `54751520` from scratch. It must sell tickets for `secret`, `huligan`, and `matvey` while preserving the current seat inventory, T-Bank payment flow, tickets, QR codes, admin operations, and refunds.

The existing website and the legacy VK Mini App remain operational until the new application passes production-like testing. No payment credentials, Firebase data layout, nginx configuration, or existing public pages are replaced during initial development.

## Release gates

The project is released only when all of these are true:

1. The Mini App opens from the VK community on iOS, Android, and desktop VK.
2. A real device under an active mobile whitelist can load show data, seat availability, and the booking API.
3. The T-Bank payment page or banking app opens under the same restricted network.
4. A booking created in the Mini App appears in the existing admin panel with source `vk-mini-app`.
5. Seat reservation, payment confirmation, ticket delivery, QR validation, cancellation, and refund use the same records as the website.
6. The existing website purchase flow remains unchanged and passes regression tests.

If gates 2 or 3 fail, the Mini App is not presented as a whitelist-safe purchase channel. It may still be released as a normal VK storefront only after explicit approval.

## Architecture

### New frontend

Add an isolated static application under `vk-mini-app/`. It contains no copied legacy Mini App code. The application uses VK Bridge only for VK launch context and native navigation. Its first screen contains three show cards and supports direct routes to each show.

The visual language follows the current KOSTYUK ticket pages: existing show artwork, names, dates, seat maps, contact form, order summary, and payment states. The layout is adapted to the VK WebView and safe areas but is not redesigned.

### Shared booking system

The Mini App calls the existing booking endpoints for each show:

- `secret`: `/api/seats` and `/api/book`
- `huligan`: `/api/seats` and `/api/huligan`
- `matvey`: `/api/matvey-seats` and `/api/matvey`

No second inventory or order database is introduced. Existing Firebase nodes remain the source of truth. The new client supplies a validated VK launch context and `source: "vk-mini-app"`; the server records the source without changing the admin data model.

### Connectivity adapter

All client requests go through one small API client module. Its base URL is configured at build/deploy time rather than scattered through UI files. This allows a whitelist-reachable API endpoint to be tested and adopted without rewriting the Mini App.

The first technical milestone is a read-only connectivity probe hosted through VK. It checks only health, show configuration, and seat reads. No booking or payment mutation is enabled until this probe succeeds on a real restricted mobile network.

VK-hosted static files alone do not guarantee that external API calls or the bank page are reachable. This is why connectivity is a release gate, not an assumption.

## User flow

1. The visitor launches "Авторские шоу" from the community or a show-specific VK tile.
2. The Mini App opens the catalog or directly opens the requested show.
3. The visitor selects date and seats using the same availability rules and prices as the website.
4. The visitor enters contact details and confirms the order summary.
5. The existing backend creates the booking and initializes T-Bank payment.
6. VK opens the returned payment URL externally or in the supported in-app browser.
7. After payment confirmation, the existing backend issues the ticket and the Mini App displays the existing ticket URL.
8. The order is immediately visible in the current admin panel. Existing cancellation, refund, and check-in actions continue to operate on it.

## Direct links

One VK application serves all shows. Community tiles use the same application with a show parameter:

- `show=secret`
- `show=huligan`
- `show=matvey`

The generic community button opens the three-show catalog. This avoids maintaining three applications while preserving one-tap entry for each poster.

## Security

- Validate VK launch parameters server-side before trusting a VK user ID.
- Never place VK secrets, Firebase secrets, T-Bank credentials, or admin credentials in the frontend.
- Mutating seat and booking calls require a valid launch context plus existing server-side validation.
- Continue using server-generated booking IDs, client keys, ticket tokens, payment signatures, and webhook verification.
- Apply an explicit CORS allowlist for the production VK application origin and the existing public site.
- Do not weaken admin authentication or expose refund operations to the Mini App.
- Treat VK profile data as optional; checkout contact fields remain explicit and user-editable.

## Error handling

The Mini App distinguishes three failure classes:

- VK shell loaded but API unavailable: show a clear temporary-unavailability screen and a community message fallback.
- Seat conflict: refresh availability and ask the visitor to choose another seat.
- Payment interrupted: preserve the booking identifier and provide a safe retry/status-check path without creating duplicate paid orders.

No failed request silently creates a second booking. Existing server idempotency and seat hold rules remain authoritative.

## Delivery stages

1. Add automated contract tests and a read-only VK connectivity probe.
2. Build the new catalog and direct show routing.
3. Implement shared API client and seat-map flows for all three shows.
4. Add booking creation, T-Bank handoff, payment return, and ticket display.
5. Add server-side VK launch validation and source tracking.
6. Verify existing admin, refund, QR, and website flows.
7. Deploy static assets to VK hosting and configure VK placement URLs.
8. Test on iOS, Android, Wi-Fi, ordinary mobile internet, and an actual whitelist restriction.
9. Only after all gates pass, replace the community tiles with links to application `54751520`.

## Non-goals

- Rebuilding the admin panel.
- Changing ticket prices, venue layouts, payment provider, or refund rules.
- Migrating existing bookings to a new database.
- Removing the current website or legacy Mini App before verification.
- Claiming whitelist resilience based only on desktop, Wi-Fi, VPN, or ordinary `curl` checks.

