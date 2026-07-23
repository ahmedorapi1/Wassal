# ADR 0003: Use PostgreSQL, PostGIS, and Prisma

- Status: Accepted
- Date: 2026-07-23

## Context

Dispatch and tracking need spatial queries; orders and money need relational
transactions and constraints. The TypeScript team also needs a typed data client.

## Decision

Use PostgreSQL with PostGIS and Prisma ORM. Store WGS84 points as
`geography(Point, 4326)`. Represent unsupported spatial fields in Prisma and use
parameterized SQL/TypedSQL in repositories for spatial operations. Customize
migrations to enable PostGIS, add spatial indexes, checks, and immutable-row triggers.

## Consequences

Core relational access is typed and migrations are reviewable. Spatial access
requires a deliberately small raw-SQL boundary and Prisma Studio cannot fully
edit unsupported spatial fields.
