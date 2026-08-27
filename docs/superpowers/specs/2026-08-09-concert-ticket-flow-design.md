# Concert ticket flow design

## Goal

Make the three concert pages feel like one compact ticket service on desktop and mobile. A visitor chooses a real seat, reviews the complete order, enters contact details, and reaches an honest payment placeholder without a false purchase confirmation.

## Flow

1. When a show has one upcoming performance, `Buy ticket` opens the hall immediately. The date, time, and venue remain visible above the scheme. A date chooser is shown only when there are multiple performances.
2. Tapping a free seat toggles its selected state and adds or removes it from the cart. The selection must remain usable when the optional reservation API is unavailable; only an explicit HTTP 409 conflict removes a seat.
3. The cart shows every selected seat, ticket count, and total. The current technical price zones remain; naming the future three commercial tiers is deferred.
4. The contact form collects name, phone, optional Telegram, promo code, and comment.
5. The review screen shows show, date, time, venue, seats, ticket count, contact, and total. `Proceed to payment` saves a local draft and explains that online payment is not connected yet.

## Responsive rules

- Mobile show storefront uses three compact list cards instead of one nearly full-screen poster per swipe.
- Booking modal fits inside `100dvh`, uses 44 px touch targets, compact typography, a readable hall, and no horizontal page scroll.
- The same components, wording, spacing, and payment state are used by Secret, Hooligan, and Save Matvey.

## Trust and accessibility

- Do not claim that a ticket, QR code, payment, or refund exists before the payment backend is connected.
- Seats have accessible labels and keyboard activation in addition to pointer/touch input.
- A network failure is reported as a synchronization limitation, not treated as a user-selection failure.

