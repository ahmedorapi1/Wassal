# ADR 0010: Versioned pricing and immutable order snapshots

- Status: accepted
- Date: 2026-07-23

## Context

Customer/address edits and pricing changes must not rewrite an accepted
commercial decision. Concurrent quote confirmation and cancellation must also
produce one consistent result.

## Decision

Pricing edits create a new `PricingRule` version. Quotes copy the selected rule
version, route, parties, addresses, package, and all integer-minor-unit money
components. Orders created from quotes copy those snapshots again.

Database triggers prevent historical-field updates/deletes. Order events are
append-only. Confirmation/cancellation use serializable transactions, row
locks, optimistic versions, request fingerprints, and durable idempotency
records.

## Consequences

Historical records are self-contained and auditable, at the cost of deliberate
snapshot duplication. Corrections require a new quote/version/event rather
than mutation.
