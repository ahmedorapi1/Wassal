# ADR 0011: PostGIS zones with a provider-neutral route port

- Status: accepted
- Date: 2026-07-23

## Context

Operational coverage is polygonal and may contain multiple zones per city.
Billable route distance must come from the backend without requiring a paid
provider in local development or tests.

## Decision

Store service zones as SRID-4326 PostGIS multipolygon geography with GiST
indexing and database geometry validity checks. Resolve both pickup and
drop-off by point containment.

Route distance/duration uses a maps provider port. Development and tests use a
deterministic, offline adapter; production can inject a vendor adapter later.
The provider/version and result are copied into quote/order snapshots.

## Consequences

Zone eligibility is authoritative, queryable, and independent of frontend
maps. Local tests are repeatable and credential-free. Production route quality
requires a separately configured adapter.
