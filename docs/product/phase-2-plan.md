# Phase 2 implementation plan

## Scope

Phase 2 adds merchant-scoped customers and addresses, PostGIS service zones,
versioned pricing rules, expiring price quotes, transactional delivery-order
confirmation, the early order state machine, immutable events, cancellation,
and merchant/admin interfaces. Existing Phase 0 and Phase 1 behavior remains
unchanged.

The active lifecycle ends at `SEARCHING_COURIER`. Phase 2 creates no dispatch
offer, assigns no courier, and exposes no order or offer to the courier app.
Cash on delivery, settlements, tracking, proof of delivery, availability,
surge, subscriptions, and the five future feature flags remain disabled.

## Execution order

1. Establish shared WASSAL tokens and assets from `reference.png`.
2. Add the Phase 2 schema and append-only migration.
3. Implement validation, the local maps provider, and pure order policies.
4. Implement merchant customer/address, quote, order, and cancellation APIs.
5. Implement admin zone, pricing, order, timeline, and cancellation APIs.
6. Add the complete Arabic-first merchant flow and Phase 2 admin surfaces.
7. Add the courier Phase 2 placeholder without offers or availability.
8. Extend deterministic seed data and documentation.
9. Verify formatting, lint, types, tests, builds, migrations, seed
   idempotency, PostGIS indexes, triggers, feature flags, and runtime health.

## Integrity strategy

- Money is integer EGP minor units calculated only by the API.
- Quotes and orders copy customer, address, package, route, pricing, and money
  snapshots.
- A quote row is locked before confirmation, and `DeliveryOrder.quoteId` is
  unique.
- Quote creation, order confirmation, and cancellation use fingerprints and
  idempotency keys.
- Order confirmation and cancellation use serializable transactions plus row
  locks and optimistic versions.
- State changes go through the centralized Phase 2 state/cancellation policy.
- PostGIS is authoritative for zone containment; the frontend map is input
  only.

## Acceptance criteria

- A merchant can create/select a customer and saved address, obtain a quote,
  confirm one order, list/detail it, view merchant-safe events, and cancel it
  when eligible.
- An admin can inspect orders, snapshots, events, audit records, service zones,
  and pricing versions, and can perform authorized cancellation/configuration
  actions.
- An order confirmed in Phase 2 is `SEARCHING_COURIER` with `courierId = null`
  and zero dispatch offers.
- All historical snapshots and events are protected from mutation.
