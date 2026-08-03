# Quote lifecycle

The merchant sends store, customer/recipient, drop-off, and package data with
an `Idempotency-Key`. The API normalizes and validates input, resolves the
PostGIS zone, requests an authoritative route from the maps provider, resolves
one pricing-rule version, calculates money, and stores a snapshot.

The configurable TTL is `QUOTE_TTL_SECONDS` (default 900). Quote states are
`ACTIVE`, `SUPERSEDED`, `EXPIRED`, `CONSUMED`, and `CANCELLED`.

- An identical idempotent request returns the original quote.
- Reusing a key with different canonical data returns `409`.
- Recalculation creates a new quote linked by `supersedesId` and marks the old
  active/expired quote superseded.
- Expired or non-active quotes cannot create an order.
- Confirmation rechecks store and zone eligibility but preserves the quoted
  pricing version; later pricing-rule changes do not rewrite or recalculate a
  still-valid quote.
- A quote is one-time because `DeliveryOrder.quoteId` is unique.

The frontend displays route distance, estimated duration, every fee component,
the merchant total, and an expiry countdown before confirmation.
