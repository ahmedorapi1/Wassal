# ADR 0008: Private, versioned courier documents

- Status: Accepted
- Date: 2026-07-23

## Context

Courier identity evidence is sensitive and review decisions must continue to
refer to the exact bytes originally submitted.

## Decision

Store bytes behind `ObjectStorageProvider` using opaque keys. Persist content
metadata and SHA-256. Never return storage keys from business APIs. Serve files
only after owner or administrator authorization. A replacement creates a new
row, links to the previous row, and marks the previous version superseded.

## Consequences

Review history is reproducible and submitted bytes are not overwritten. Local
development uses protected filesystem storage; production requires a private,
encrypted object-store adapter with short-lived signed operations and scanning.
