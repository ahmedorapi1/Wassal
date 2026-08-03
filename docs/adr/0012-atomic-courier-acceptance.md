# ADR 0012 — Atomic courier-selected acceptance

## Status

Accepted for Phase 3.

## Decision

Eligible couriers discover orders through service-zone membership and accept
them directly. PostgreSQL serializable transactions, a row lock, status/version
conditional update, durable idempotency, and append-only event/audit evidence
make the first committed courier the winner. Losing couriers receive HTTP 409.

`DispatchOffer` remains dormant and is not assignment authority. Proximity,
current GPS, and an availability switch are not inputs.

## Consequences

The MVP is deterministic and concurrency-safe without a dispatch engine.
Marketplace cards must remain privacy-reduced until the transaction assigns the
courier. A future dispatch design must supersede this ADR explicitly instead of
silently introducing a second assignment authority.
