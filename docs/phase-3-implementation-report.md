# WASSAL Phase 3 implementation report

**Completed:** 2026-07-27  
**Primary specification:** `phase-3.md`  
**Migration:** `20260726190000_phase_3_marketplace_accounting`

## 1. Executive summary

Phase 3 is implemented as an executable end-to-end product flow, not dormant
schema or UI mockups. Eligible couriers can discover privacy-reduced orders in
their explicitly assigned service zones. Ten different couriers can race to
accept one order; PostgreSQL assigns exactly one winner and all losers receive
HTTP 409. The winner sees full operational data and can complete pickup,
delivery, failed-delivery/return, or pre-pickup requeue workflows.

An order becomes `COMPLETED` only during atomic financial finalization.
Completion appends exactly one 20% commission liability and attaches it to the
courier's Cairo-calendar weekly settlement. Finance administrators can close
ended settlements and record partial/final payments that already occurred
outside WASSAL. Super administrators can manage versioned settings and create
append-only corrections, waivers, and reversals.

The complete repository verification passes: 118 tests, all 13 workspace type
checks, lint, formatting, Prisma validation, clean migration/seed, and all five
production builds.

## 2. Product decisions implemented

- Direct, courier-selected marketplace; no automatic dispatch.
- Explicit courier-to-service-zone membership.
- Eligibility requires active account, approved verification, active
  motorcycle, and all current required documents approved/unexpired.
- Privacy-reduced marketplace data until assignment.
- First committed eligible courier wins atomically.
- Pre-pickup courier cancellation requeues the order.
- No normal cancellation after pickup; failure follows a typed return path.
- Returned orders retain the original delivery fee and create one commission.
- `DELIVERED`/`RETURNED` are operational reports; `COMPLETED` is financial
  finalization.
- Default commission is 2,000 basis points (20%).
- Settlement cycle is weekly with seven Cairo-calendar grace days.
- External payments are records of money already transferred outside WASSAL.
- Partial payments are supported and allocated oldest outstanding settlement
  first; overpayment is rejected.
- Normal history is immutable; corrections are compensating records.

## 3. Database changes

The canonical Prisma schema now includes:

- `COMPLETED` and the complete typed lifecycle/event values;
- `platformCommissionBasisPoints` on quote and order snapshots;
- `financialFinalizedAt` on orders;
- append-only, versioned `PlatformFinancialSetting`;
- explicit `CourierServiceZone` membership;
- append-only `CourierLedgerEntry`;
- `SettlementPeriod` and unique `SettlementLine`;
- append-only `ExternalPaymentRecord` and allocation records;
- reversal/source/idempotency uniqueness;
- EGP, amount-sign, date, projection, assignment, and completion constraints;
- payment-overallocation and append-only database triggers;
- one `COMMISSION_DUE` entry per completed order.

Dormant wallet, dispatch-offer, and tracking tables were preserved but were not
made authoritative or given writers.

## 4. Migration

`infrastructure/database/prisma/migrations/20260726190000_phase_3_marketplace_accounting/migration.sql`

The migration:

1. expands the enum/domain state;
2. temporarily removes Phase 2 quote/order immutability triggers;
3. adds and backfills the historical commission-rate snapshots;
4. restores expanded immutability in the same migration;
5. replaces the Phase 2 assignment restriction with Phase 3 constraints;
6. creates settings, memberships, ledger, settlement, payment, and allocation
   structures;
7. backfills approved courier zone memberships;
8. installs final database constraints/triggers.

PostgreSQL requires newly added enum values to commit before direct enum-literal
use. The Phase 3 order check casts the status to text inside the same migration,
so the one migration applies correctly both from a Phase 2 database and from
zero.

## 5. New and modified files

### New Phase 3 implementation files

- `apps/api/src/auth/permissions.decorator.ts`
- `apps/api/src/auth/permissions.guard.ts`
- `apps/api/src/courier-orders/courier-orders.controller.ts`
- `apps/api/src/courier-orders/courier-orders.service.ts`
- `apps/api/src/finance/admin-finance.controller.ts`
- `apps/api/src/finance/courier-finance.controller.ts`
- `apps/api/src/finance/finance-domain.ts`
- `apps/api/src/finance/finance-domain.test.ts`
- `apps/api/src/finance/finance.service.ts`
- `apps/api/src/finance/settlement-projection.ts`
- `apps/api/src/phase-three-database.integration.test.ts`
- `apps/api/src/phase-three.e2e.test.ts`
- `apps/courier-mobile/external-navigation.ts`
- `apps/courier-mobile/external-navigation.test.ts`
- `apps/courier-mobile/operational-app.tsx`
- `apps/admin-web/app/phase-three-finance.tsx`
- `apps/worker/src/settlement-jobs.ts`
- `packages/validation/src/phase-three.ts`
- the Phase 3 migration above
- the Phase 3 architecture/API/ADR/report documents listed below

### Main modified implementation files

- Prisma schema, deterministic seed, and `prisma.config.ts`
- API application module, order domain/service/controllers, admin order
  controller/service, courier eligibility policy, and approval zone hook
- shared contracts, RBAC permissions/tests, and validation exports
- Expo `App.tsx`
- admin application, tests, and styles
- merchant application and tests
- worker composition/package manifest
- root package manager metadata and lockfile
- README, architecture overview, RBAC matrix, and ADR index

## 6. New APIs

Courier marketplace/lifecycle:

- `GET /couriers/orders/available`
- `GET /couriers/orders/available/:orderId`
- `POST /couriers/orders/:orderId/accept`
- `GET /couriers/orders/current`
- `GET /couriers/orders/history`
- typed lifecycle commands for arriving/arrived pickup, picked up, in transit,
  arrived drop-off, delivered, delivery failed, returning, and returned
- `POST /couriers/orders/:orderId/cancel` before pickup

Courier accounting:

- `GET /couriers/account/summary`
- `GET /couriers/account/entries`
- `GET /couriers/settlements`
- `GET /couriers/settlements/:settlementId`

Admin finance:

- `GET/PATCH /admin/financial-settings`
- `GET /admin/courier-accounts`
- `GET /admin/couriers/:courierId/account`
- `GET /admin/settlements`
- `GET /admin/settlements/:settlementId`
- `POST /admin/settlements/:settlementId/close`
- `POST /admin/couriers/:courierId/external-payments`
- `POST /admin/external-payments/:paymentId/reverse`
- `POST /admin/couriers/:courierId/adjustments`
- `GET /admin/settlements/:settlementId/export.csv`

Request/response examples are in `docs/api/phase-3-routes.md`.

## 7. New courier screens

Approved couriers now enter an operational four-tab experience:

1. **Available:** zone-eligible, privacy-safe order cards and atomic acceptance.
2. **Current:** full assigned details, external pickup/drop-off navigation,
   complete lifecycle actions, failure/return, and pre-pickup requeue.
3. **History:** completed, returned, cancelled/requeued history.
4. **Account:** order counts, commission totals, remaining amount, settlement
   deadlines/statuses, and immutable statement entries.

There is no online switch, device location permission, location upload, map
SDK, or live tracking.

## 8. New admin screens

The Phase 3 finance workspace provides:

- current versioned settings and history;
- courier account list/filter/summary;
- detailed statement, settlements, payments, and audit evidence;
- ended-settlement close;
- external partial/final payment recording;
- super-admin-only adjustment/waiver controls;
- super-admin-only payment reversal;
- authenticated settlement CSV export.

The component checks the current user role before loading financial data.
Operations-only administrators see a clear access-denied explanation rather
than finance controls. Backend permission guards remain the final authority.

## 9. Marketplace concurrency design

Acceptance uses a durable idempotency record and a serializable transaction.
It locks the order row, revalidates status/version/eligibility/zone, performs a
conditional update, and appends the acceptance event and audit record before
commit.

The executed 10-courier test result:

- HTTP 201 successes: **1**
- HTTP 409 losers: **9**
- assigned couriers: **1**
- `COURIER_ACCEPTED` events: **1**
- assignment audit records: **1**
- accepted `DispatchOffer` records: **0**
- order version after acceptance: **2**

An E2E run exposed an initial idempotency-scope string exceeding the existing
100-character column. The final scope uses action plus order UUID, remains
resource-specific, and passes the complete lifecycle.

## 10. Commission calculation design

All persisted money is integer minor units. Basis-point rounding uses `BigInt`
integer arithmetic with half-up behavior:

```text
commission = round_half_up(total × basisPoints / 10,000)
net = total - commission
```

The executed EGP 100.00 example produces EGP 20.00 commission and EGP 80.00
courier net. The exact 2,000-basis-point setting is stored on the quote and
copied to the order. Later setting versions cannot mutate historical
snapshots.

## 11. Settlement and payment design

`COMPLETED` creates one positive commission ledger entry and one unique line in
the courier's open Cairo week. The repeatable worker closes ended periods and
marks unpaid past-due periods overdue.

Ledger sign convention:

- commission/debit: positive liability;
- credit/waiver/external payment: negative liability;
- reversal: equal and opposite to its unique original.

External payment commands lock closed outstanding settlements and allocate
oldest first. Partial payments update status to `PARTIALLY_PAID`; the final
remainder produces `PAID`. Any amount exceeding total outstanding is rejected.
Source records remain append-only.

## 12. RBAC changes

- Courier: own marketplace, accepted lifecycle, account, and statements only.
- Merchant roles: own merchant customers/orders only; no courier finance.
- Support: operational read only.
- Operations admin: order/courier operations; no Phase 3 finance access.
- Finance admin: settings read, account/settlement read, close, payment record,
  and CSV export.
- Super admin: all finance permissions, including setting changes,
  adjustments, waivers, and reversals.

Permissions are explicit shared contract values and controller metadata, not
only frontend conditions.

## 13. Test coverage

The final suite has **28 passing files and 118 passing tests**.

Phase 3 coverage includes:

- eligibility and active service-zone membership;
- allowed/rejected lifecycle transitions;
- 20% example, basis-point rounding, and historical snapshot;
- Cairo DST-aware weekly boundaries and days remaining;
- settlement projection/status/overdue behavior;
- partial payment, overpayment, oldest-first allocation;
- adjustment, waiver, and reversal sign behavior;
- one assignment under concurrent updates;
- one commission/settlement line per order;
- immutable ledger/payment records;
- unique idempotency/reversal links;
- transaction rollback and EGP/date constraints;
- complete delivered and returned HTTP journeys;
- pre-pickup cancellation and different-courier reassignment;
- merchant/courier ownership and admin role separation;
- external navigation URL validation.

## 14. Verification commands and exact results

| Command                                                                    | Result                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `node_modules\.bin\prettier.cmd --check .`                                 | Pass; all matched files formatted                                                      |
| `node_modules\.bin\eslint.cmd . --max-warnings 0`                          | Pass; zero warnings/errors                                                             |
| `pnpm.cmd --config.verify-deps-before-run=false typecheck`                 | Pass; 13/13 workspace tasks                                                            |
| `pnpm.cmd --config.verify-deps-before-run=false test`                      | Pass; 28 files, 118 tests                                                              |
| `pnpm.cmd --config.verify-deps-before-run=false build`                     | Pass; 5/5 application builds                                                           |
| `node_modules\.bin\prisma.cmd validate`                                    | Pass                                                                                   |
| `node_modules\.bin\prisma.cmd migrate deploy` on existing Phase 2 database | Pass; Phase 3 migration applied                                                        |
| clean database `prisma migrate deploy`                                     | Pass; all 4 migrations applied                                                         |
| clean database `prisma db seed` twice                                      | Pass twice; idempotent                                                                 |
| clean database `prisma migrate status`                                     | Pass; schema up to date                                                                |
| `git diff --check`                                                         | Pass                                                                                   |
| forbidden-capability searches                                              | No location capability, payment integration, tracking writer, or dispatch writer found |
| `docker compose ps` / Redis ping                                           | PostGIS and Redis healthy; `PONG`                                                      |

The managed noninteractive Windows environment caused pnpm 11's
dependency-status auto-repair to try to purge/reinstall `node_modules`.
`--config.verify-deps-before-run=false` disables that pre-run mutation only;
the actual repository scripts and complete checks still execute. The
repository pin was aligned to the installed pnpm 11.16 runtime.

Build outputs:

- API ESM bundle: pass
- Worker ESM bundle: pass
- Admin Next.js optimized/static build: pass
- Merchant Next.js optimized/static build: pass
- Courier Expo Android/Hermes export: pass (603 modules)

## 15. Remaining limitations

- Distance/duration use the existing offline deterministic estimator, not road
  routing.
- Navigation leaves WASSAL and opens an external maps application.
- Available orders update through pull-to-refresh, not push notifications.
- External-payment correctness depends on finance staff confirming the
  off-app transaction/reference.
- The worker currently uses repeatable polling rather than an operational
  scheduler dashboard.
- Seed content is synthetic and local storage remains a development adapter.
- No courier-specific commission overrides were added.

## 16. Deferred future features

- live/background GPS and tracking;
- automatic dispatch/matching or targeted offers;
- payment gateway, wallet, payout, or automatic transfer;
- COD collection;
- proof-of-delivery;
- push notifications;
- ratings, scheduled delivery, multi-stop, subscription, and surge features;
- commercial geocoding/road-routing provider.

No deferred capability was partially introduced as active behavior.

## 17. Updated MVP implementation percentage

- Requested Phase 3 specification completion: **100%**
- Broader location/marketplace/finance MVP readiness: **88%**

The remaining 12% reflects production operations/provider choices and deferred
features above, not missing Phase 3 core journeys. The implementation now
provides the formerly blocking marketplace, acceptance, lifecycle, commission,
settlement, manual-payment, ownership, concurrency, audit, and reconciliation
capabilities.

## Documentation delivered

- `docs/architecture/phase-3-marketplace-accounting.md`
- `docs/api/phase-3-routes.md`
- `docs/adr/0012-atomic-courier-acceptance.md`
- `docs/adr/0013-append-only-courier-accounting.md`
- `docs/architecture/rbac-matrix.md`
- `README.md`
- this report
