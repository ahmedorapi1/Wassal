# SKKA order cancellation and courier-acceptance timeout report

Date: 2026-08-02  
Migration: `20260802120000_order_cancellation_acceptance_timeout`

## Outcome

Before this update, a merchant could cancel only an unassigned `DRAFT`,
`QUOTED`, or `SEARCHING_COURIER` order. Assignment blocked cancellation,
post-pickup cancellation had no merchant return path, marketplace publication
had no persisted deadline or retry count, and an unaccepted order could remain
searchable indefinitely.

The new behavior is described below.

The merchant cancellation cutoff is the committed transition to `PICKED_UP`.
An owner or manager can cancel for free through `AT_PICKUP`, including while a
courier is assigned or arriving. The order becomes `CANCELLED`, its courier is
detached, its marketplace/active-order views are invalidated, the courier is
notified, and no delivery commission or cancellation charge is created.

From `PICKED_UP` through the states where the courier still possesses the
package, cancellation records the merchant actor, reason, details, time, and
full original delivery value, then moves the same order to
`RETURNING_TO_STORE`. It uses the existing courier-return and merchant-return
confirmation workflow. There is no second trip price and no extra return fee.
The existing finalization service creates the normal commission exactly once
only after the merchant confirms the returned package.

Merchant staff remain forbidden by both controller RBAC and service policy.
Merchant lookup remains tenant-scoped. Couriers cannot invoke merchant/admin
cancellation commands. Closed terminal states reject cancellation.

## Acceptance timeout

Every marketplace publication persists `acceptanceExpiresAt` at exactly five
minutes after publication and a `dispatchAttemptCount`. The initial order uses
attempt 1. The worker checks expired unassigned `SEARCHING_COURIER` orders every
15 seconds, locks each row, rechecks status/courier/deadline, and commits one of:

- attempt 1: `NO_COURIER_AVAILABLE`, with one owner/manager retry available;
- attempt 2: `NO_COURIER_AVAILABLE_FINAL`, with no further retry.

`POST /api/v1/orders/:orderId/retry-courier-search` is owner/manager-only,
versioned, tenant-scoped, serializable, and idempotent. It republishes the same
order for five new minutes and does not create financial data. Both timeout
states remain freely cancellable.

Courier list/detail queries require a future persisted deadline. Acceptance
locks the order and repeats the deadline check in the transaction; a tap at or
after the deadline returns `COURIER_ACCEPTANCE_EXPIRED` with the Arabic message
`انتهت مدة قبول هذا الطلب.`

## API changes

- `POST /api/v1/orders` now starts attempt 1 and persists its five-minute
  deadline.
- `POST /api/v1/orders/:orderId/cancel` now applies the pickup financial cutoff
  and existing return flow.
- `POST /api/v1/orders/:orderId/retry-courier-search` is new and starts the only
  permitted retry.
- `GET /api/v1/couriers/orders/available` and its detail route omit expired
  orders.
- `POST /api/v1/couriers/orders/:orderId/accept` rejects a persisted expired
  deadline inside the locked transaction.

## Concurrency and idempotency

Acceptance, merchant cancellation, retry, courier lifecycle transitions, and
worker expiration all lock the same `DeliveryOrder` row. Commit order is the
decision boundary:

- acceptance committed first makes worker expiry a no-op;
- timeout committed first makes acceptance return the expiry error;
- free cancellation committed first makes acceptance fail and removes the
  order from active courier state;
- `PICKED_UP` committed first makes merchant cancellation a return;
- cancellation committed first makes the courier pickup transition fail;
- duplicate worker/retry/cancel execution cannot create duplicate events,
  notifications, or financial entries.

PostgreSQL serialization conflicts are retried once from a fully rolled-back
transaction. The retry then re-reads the committed row and returns the normal
domain conflict (`409`) instead of leaking a database serialization error as
`500`.

The worker publishes minimized invalidation messages through Redis channel
`wasel:realtime:v1`; the API process forwards them into authorized Socket.IO
rooms. REST remains authoritative and all clients retain reconciliation.

## User interfaces

- Merchant Web shows attempt number, a live five-minute countdown, first/final
  timeout messages, one retry action, free-cancellation text before pickup, and
  the required full-fee return warning after pickup.
- Courier Mobile removes expired cards locally every second and by realtime
  invalidation, rejects late taps clearly, and shows the merchant-cancelled
  return instruction with the preserved original delivery value.
- Admin Web shows dispatch attempt count, publication/expiry event metadata,
  cancellation actor/reason/time, before/after-pickup classification, charged
  delivery value, resulting/pending ledger state, audit, and full transitions.

## Verification

- Prisma client generation: passed.
- Type checks: API, worker, merchant web, admin web, courier mobile, and database
  packages passed.
- Focused unit/UI regression suite: 41 tests passed.
- Worker integration: 2 tests passed, including duplicate concurrent execution
  and first/final timeout states.
- Phase 3 marketplace/accounting E2E: 13 tests passed, including ten-courier
  acceptance race, late acceptance, retry idempotency/limit, assigned free
  cancellation, post-pickup return conversion, and exactly one commission.
- Migration deploy and deterministic seed: passed against local PostgreSQL 18 /
  PostGIS; a second deploy of all nine migrations passed on a fresh temporary
  database, which was then removed. Redis and PostgreSQL containers were
  healthy.
- Full repository lint and typecheck: passed. Full affected-application build
  passed (API, worker, Admin Web, Merchant Web, and Android Expo export); the
  API build was repeated after the final race-handling adjustment and passed.
- The full shared `pnpm test` run passed 289 of 291 tests. Its two failures are
  pre-existing cross-file database-fixture isolation issues: a Phase 4 worker
  test reads a fixed dispute order that another E2E suite completes, and a
  service-zone suite shares mutable zone/pricing state with parallel E2E files.
  All 56 cancellation/timeout-related tests pass when run as the linked focused
  suite, including the newly added race tests.
- Repository-wide `format:check` is still blocked by two unrelated pre-existing
  files (`apps/api/src/service-zones.e2e.test.ts` and
  `WASSAL_admin_operations_updates_1_to_4.md`). Every file changed by this
  update passes Prettier/Prisma formatting.

## Manual verification

1. Sign in as merchant owner, create an order, and open its details. Confirm
   attempt `1 من 2` and a countdown starting near five minutes.
2. Before courier pickup, cancel an unassigned order and an assigned/arriving
   order. Confirm `CANCELLED`, zero cancellation charge, no ledger entry, and a
   courier notification/removal when assigned.
3. Create another order and leave it unaccepted for five minutes. Confirm it
   disappears from Courier Mobile, becomes `NO_COURIER_AVAILABLE`, and shows
   retry/cancel actions to the merchant.
4. Choose `إعادة البحث عن مندوب`. Confirm attempt 2, a fresh five-minute
   countdown, and the same order number.
5. Let attempt 2 expire. Confirm `NO_COURIER_AVAILABLE_FINAL`, no retry button,
   the support message, and free cancellation.
6. On a stale courier card, tap accept after the deadline and confirm
   `انتهت مدة قبول هذا الطلب.`
7. Create and accept an order, advance it through `PICKED_UP`, then cancel as
   the merchant. Confirm the warning, `RETURNING_TO_STORE`, the original fee as
   the cancellation charge, no extra return price, and the courier return UI.
8. Let the courier report the return and confirm it as the merchant. Confirm
   the order completes and exactly one normal commission entry exists.
9. Sign in as operations/super admin and inspect the same orders. Confirm each
   publication/expiry event, attempt count, cancellation actor/reason/time,
   before/after-pickup classification, charge, pending/final ledger, and audit.

## Scope notes

All requested behavior was implemented using existing cancellation and return
states where possible. No separate return price, extra return fee, third search
attempt, automated dispatch-offer model, or later-phase feature was added.

## Files changed for this update

- `infrastructure/database/prisma/schema.prisma`
- `infrastructure/database/prisma/seed.ts`
- `infrastructure/database/prisma/migrations/20260802120000_order_cancellation_acceptance_timeout/migration.sql`
- `packages/contracts/src/orders.ts`
- `packages/validation/src/phase-two.ts`
- `apps/api/src/orders/order-domain.ts`
- `apps/api/src/orders/order-domain.test.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/courier-orders/courier-orders.service.ts`
- `apps/api/src/admin/phase-two-admin.controller.ts`
- `apps/api/src/admin/phase-two-admin.service.ts`
- `apps/api/src/realtime/realtime.service.ts`
- `apps/api/src/realtime/realtime.service.test.ts`
- `apps/api/src/phase-three.e2e.test.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/order-acceptance-timeout.ts`
- `apps/worker/src/order-acceptance-timeout.test.ts`
- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/merchant-app.test.tsx`
- `apps/courier-mobile/operational-app.tsx`
- `apps/courier-mobile/acceptance-timeout-flow.test.ts`
- `apps/admin-web/app/admin-app.tsx`
- `apps/admin-web/app/admin-app.test.tsx`
- `apps/admin-web/app/admin-operations-workspaces.tsx`
- `README.md`
- `docs/phase-4-implementation-report.md`
- `docs/order-cancellation-and-acceptance-timeout-report.md`
