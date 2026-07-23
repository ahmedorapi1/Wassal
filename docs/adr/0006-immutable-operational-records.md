# ADR 0006: Keep events, ledgers, and audit records immutable

- Status: Accepted
- Date: 2026-07-23

## Context

Delivery disputes, concurrency, admin intervention, and money movement require a
trustworthy history, not mutable status fields alone.

## Decision

Persist order transitions as `OrderEvent`, financial movements as `LedgerEntry`,
and sensitive actions as `AuditLog`. Database triggers reject updates and
deletes. Commands use idempotency keys and aggregate versions; current balance
and status fields are projections optimized for reads.

## Consequences

History is explainable and replayable. Corrections require compensating records,
and retention/partitioning will need explicit planning as volume grows.
