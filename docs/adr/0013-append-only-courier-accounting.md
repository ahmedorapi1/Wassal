# ADR 0013 — Append-only courier accounting

## Status

Accepted for Phase 3.

## Decision

The commission rate is versioned and snapshotted in basis points on quotes and
orders. Financial completion appends one commission liability. Weekly
settlements reference immutable ledger entries. External payments record only
money that moved outside WASSAL and allocate oldest outstanding settlements
first. Corrections use uniquely linked waivers, adjustments, or reversals.

Source ledger rows, settlement lines, payment records, and allocations cannot
be updated or deleted. Settlement totals/status are rebuildable projections.

## Consequences

Historical amounts remain explainable after settings change. Retry,
reconciliation, and audit are strong, but administrators cannot “fix” history
in place. This phase provides no wallet, payment gateway, payout provider, or
automatic transfer.
