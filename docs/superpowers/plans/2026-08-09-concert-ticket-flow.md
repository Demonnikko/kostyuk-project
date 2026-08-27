# Concert ticket flow implementation plan

## Task 1: Shared tested ticket core

1. Add a Node test for adding/removing seats, selection limits, rollback policy, and order draft creation.
2. Run the test and confirm it fails because the shared core does not exist.
3. Add `concerts/ticket-flow.js` with pure selection and draft helpers.
4. Run the test and confirm it passes.

## Task 2: Shared compact checkout styling

1. Add `concerts/ticket-flow.css` for a viewport-safe modal, compact hall/cart/form, and mobile touch targets.
2. Load the shared files on all three show pages.

## Task 3: Unify the three booking flows

1. Open directly on the hall when only one performance exists.
2. Keep selected seats on network/offline failures and roll back only on HTTP 409.
3. Add accessible seat controls with larger hit targets.
4. Build and persist an order draft after contact validation.
5. Show the full order review and an honest payment-not-connected action.
6. Remove unreachable false ticket/QR success claims.

## Task 4: Compact mobile storefront

1. Replace the single-card horizontal mobile carousel with three compact show cards.
2. Keep show identity, date, venue, sales state, and action readable.

## Task 5: Verification

1. Run the ticket-core tests and existing project checks that are available.
2. Start the local server.
3. Verify storefront and every show at mobile and desktop widths.
4. Verify seat toggle, cart, contact validation, order review, payment placeholder, overflow, and console errors.

