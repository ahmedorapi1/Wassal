# Data architecture

The Prisma schema in `infrastructure/database/prisma/schema.prisma` is the
canonical model through Phase 1. The first migration enables PostGIS and creates
spatial GiST indexes; the second adds identity sessions, membership state, and
versioned courier verification without removing those indexes.

## Aggregate ownership

| Aggregate  | Root                       | Important dependents                                     |
| ---------- | -------------------------- | -------------------------------------------------------- |
| Identity   | `User`                     | `OtpChallenge`, `Session`, membership, courier profile   |
| Merchant   | `Merchant`                 | stores, customers, saved addresses                       |
| Courier    | `CourierProfile`           | vehicles, documents, dispatch offers, tracking           |
| Delivery   | `DeliveryOrder`            | events, offers, tracking, proofs, ratings, support cases |
| Pricing    | `PricingRule`              | immutable version and generated quotes                   |
| Finance    | `Wallet`                   | append-only ledger entries and settlements               |
| Operations | `FeatureFlag` / `AuditLog` | rollout state, verification events, immutable evidence   |

## Consistency and immutability

- UUIDs are used for externally visible entity identifiers.
- Tracking and audit rows use ordered 64-bit identifiers for write efficiency.
- `DeliveryOrder.version`, `DispatchOffer.version`, and `Wallet.version` support
  compare-and-swap updates in later command handlers.
- A database trigger rejects `UPDATE` and `DELETE` on `OrderEvent`,
  `LedgerEntry`, `AuditLog`, and `CourierVerificationEvent`.
- Merchant, membership, store, courier, vehicle, and document versions protect
  Phase 1 state-changing commands.
- Membership roles are constrained to merchant roles (`OWNER`, `MANAGER`, or `STAFF`).
- Rating scores and feature rollout percentages are protected by database checks.
- COD-related columns and ledgers exist, but `cash_on_delivery` is seeded disabled.

## Spatial data

Coordinates use PostGIS `geography(Point, 4326)` so distance calculations operate
in meters on WGS84. Prisma represents these as optional `Unsupported` fields;
domain repositories must use parameterized raw SQL/TypedSQL for spatial reads and
writes. Never interpolate coordinates into SQL strings.

## Money

Amounts use fixed-scale decimal columns and an ISO 4217 currency code. EGP is the
default, not an assumption in pricing logic. Pricing rules are versioned and the
version used for an order is persisted. Ledger entries are signed, immutable
movements with unique idempotency keys.
