# ADR 0009: Transactional courier verification with OCC

- Status: Accepted
- Date: 2026-07-23

## Context

Two operations reviewers can otherwise issue contradictory decisions against
the same document or application.

## Decision

Document actions compare `reviewVersion`; profile actions compare `version` and
the allowed source state. The state update, verification event, and audit log
share one database transaction. A stale predicate returns a conflict.
`CourierVerificationEvent` is append-only at the database layer.

## Consequences

Concurrent review is deterministic and the recorded decision cannot exist
without its state change. Clients must reload after HTTP 409 before retrying.
