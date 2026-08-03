# WASSAL Phase 3 — Courier Marketplace and Offline Commission Accounting MVP

Implement the next production-ready MVP phase for the WASSAL motorcycle delivery platform.

This phase must add:

1. A self-service available-order marketplace for couriers.
2. Atomic first-courier-wins order acceptance.
3. Courier order lifecycle support.
4. A configurable platform commission with a default of 20%.
5. Immutable commission snapshots.
6. Courier accounting and weekly settlement periods.
7. Manual recording of external payments by administrators.
8. Courier and admin financial summaries.
9. External navigation links without live tracking.

Do not add live tracking, in-app payments, payment gateways, courier wallets, or automatic money transfers.

Before changing code, read:

- `docs/Report.md`
- Existing architecture documentation.
- Existing Phase 1 and Phase 2 migrations.
- Existing order-domain tests.
- Existing Phase 2 E2E tests.

Use the existing monorepo architecture and conventions. Do not rewrite working Phase 1 or Phase 2 functionality.

---

# 1. Fixed Product Decisions

Use the following product decisions for this implementation.

## 1.1 Courier Location

The MVP must not include:

- Live courier location.
- Background GPS.
- Continuous courier location uploads.
- Tracking WebSockets.
- Courier movement history.
- Live ETA.
- Admin courier map.
- Embedded navigation map.
- Google Maps API, Mapbox API, HERE API, or another paid routing API.

Do not add `expo-location` or any equivalent package.

Keep the existing deterministic local maps provider for pricing.

The courier app may open an external navigation application using stored coordinates and React Native `Linking`.

Provide two actions after acceptance:

- Navigate to pickup.
- Navigate to delivery.

Generate safe external navigation URLs from the order coordinates.

Do not request courier location permission.

Keep the following dormant and unused for future phases:

- `CourierProfile.lastLocation`
- `CourierProfile.lastLocationAt`
- `TrackingPoint`
- Tracking-related optional location fields

Do not build writers, endpoints, workers, or UI for them.

## 1.2 Courier Eligibility

A courier may view and accept an available order only when:

- The courier account is active.
- Courier verification is approved.
- The courier is not suspended.
- The courier has an active motorcycle vehicle.
- The order is in `SEARCHING_COURIER`.
- The order has no assigned courier.
- The courier operates in the same city or service zone as the order.

Do not use courier proximity or current GPS.

Implement explicit courier operating-area membership using the smallest coherent database design.

Prefer linking a courier to supported service zones.

A courier may belong to more than one active service zone.

## 1.3 Marketplace Privacy

Before acceptance, show only:

- Order number.
- Pickup store name.
- Pickup area or service-zone name.
- Drop-off area or service-zone name.
- Approximate route distance.
- Approximate route duration.
- Package size.
- Package weight.
- Fragile or thermal-bag indicators.
- Delivery fee.
- Estimated courier net amount.
- Created time.

Before acceptance, do not show:

- Full customer phone number.
- Exact customer address details beyond the safe area summary.
- Customer notes containing sensitive information.

After successful acceptance, the assigned courier may view the full operational pickup and delivery information.

## 1.4 Order Acceptance

The marketplace uses direct courier acceptance.

Do not use `DispatchOffer` as the assignment authority for this MVP.

The authoritative assignment must be a conditional update to `DeliveryOrder`.

Acceptance must succeed only when:

- `status = SEARCHING_COURIER`
- `courierId IS NULL`

The first successful courier wins.

All later attempts must return HTTP `409 Conflict`.

Acceptance must run inside one database transaction and must atomically:

1. Validate courier eligibility.
2. Lock or conditionally update the order.
3. Assign `courierId`.
4. Change status to `COURIER_ASSIGNED`.
5. Increment the order version.
6. Append an immutable order event.
7. Write an audit-log entry.
8. Commit durable idempotency.

Use the existing transaction, row-lock, version, idempotency, event, and audit patterns already implemented for quote confirmation and cancellation.

A repeated request using the same idempotency key must return the same successful result rather than create duplicate events.

## 1.5 Order Lifecycle

Make the following statuses executable:

- `SEARCHING_COURIER`
- `COURIER_ASSIGNED`
- `COURIER_ARRIVING_PICKUP`
- `AT_PICKUP`
- `PICKED_UP`
- `IN_TRANSIT`
- `AT_DROPOFF`
- `DELIVERED`
- `DELIVERY_FAILED`
- `RETURNING_TO_STORE`
- `RETURNED`
- `CANCELLED`

Add a financial finalization state:

- `COMPLETED`

The normal successful flow is:

`SEARCHING_COURIER`
→ `COURIER_ASSIGNED`
→ `COURIER_ARRIVING_PICKUP`
→ `AT_PICKUP`
→ `PICKED_UP`
→ `IN_TRANSIT`
→ `AT_DROPOFF`
→ `DELIVERED`
→ `COMPLETED`

`DELIVERED` means the courier reported delivery.

`COMPLETED` is the financially final state.

For this MVP, the system may automatically move an order from `DELIVERED` to `COMPLETED` in the same transaction unless an unresolved return or delivery-failure flow exists.

Every transition must:

- Validate the current state.
- Validate the assigned courier where applicable.
- Require the current order version.
- Support an idempotency key.
- Increment the version.
- Append an immutable order event.
- Write an audit record where appropriate.
- Return `409 Conflict` for stale versions or invalid concurrent changes.

Extend `OrderEventType` with clear event types for:

- Courier accepted.
- Courier arriving at pickup.
- Courier arrived at pickup.
- Order picked up.
- Order in transit.
- Courier arrived at drop-off.
- Delivered.
- Completed.
- Delivery failed.
- Returning to store.
- Returned.
- Courier cancelled.
- Admin cancelled.

Do not use a generic note event when a typed event is appropriate.

## 1.6 Cancellation Policy

Before pickup:

- An assigned courier may cancel the order.
- The order returns to `SEARCHING_COURIER`.
- `courierId` becomes null.
- The cancellation is recorded as an event and audit entry.
- No platform commission is created.
- The order becomes available to another eligible courier.

After `PICKED_UP`:

- Do not allow normal courier cancellation.
- Use `DELIVERY_FAILED` and return workflow instead.

Merchant cancellation remains allowed only under the existing pre-assignment rules unless explicitly allowed by the current domain policy.

Do not silently cancel an order after pickup.

## 1.7 Return Policy

For the MVP:

- A return occurs only after pickup when delivery cannot be completed.
- The flow is:

  - `DELIVERY_FAILED`
  - `RETURNING_TO_STORE`
  - `RETURNED`
  - `COMPLETED`

- A returned order counts as one returned order for courier statistics.
- The original delivery attempt remains a completed courier service for accounting.
- The courier receives the original snapshotted courier net amount.
- The platform receives the original snapshotted commission.
- Do not add a separate return-trip charge in this phase.
- Keep `returnTripBaseMinor` unused for future pricing.
- Do not reverse the original commission.
- Do not create a second commission for the return.

This is intentionally simple for the MVP.

## 1.8 Commission

Add versioned platform financial settings.

The default platform commission must be:

`2000 basis points = 20%`

The setting must be editable only by `super_admin`.

Store:

- Default commission basis points.
- Settlement cycle type.
- Grace-period days.
- Operations timezone.
- Effective-from timestamp.
- Version.
- Creator/admin actor.
- Created timestamp.

Default values:

- Commission: `2000` basis points.
- Settlement cycle: `WEEKLY`.
- Grace period: `7` calendar days.
- Operations timezone: `Africa/Cairo`.

Changing the current setting must create a new effective version or an equivalent auditable historical record.

It must never recalculate historical quotes or orders.

## 1.9 Commission Snapshot

Add a typed immutable field to both `PriceQuote` and `DeliveryOrder`:

- `platformCommissionBasisPoints`

Continue storing:

- `platformCommissionMinor`
- `estimatedCourierEarningMinor`
- `currency`

All money must remain in integer minor units.

Do not use JavaScript floating-point arithmetic for money.

For a delivery fee of EGP 100.00:

- Total: `10000` minor units.
- Rate: `2000` basis points.
- Platform commission: `2000` minor units.
- Courier net: `8000` minor units.

The quote and order must retain the exact rate and amounts used.

Existing historical Phase 2 orders must remain valid.

Do not mutate old snapshots.

## 1.10 Financial Finalization

Do not create a payable commission when an order is:

- Quoted.
- Created.
- Searching.
- Accepted.
- Picked up.
- In transit.
- Merely delivered but not financially completed.

Create the courier commission liability exactly once when the order enters `COMPLETED`.

In the same database transaction:

1. Set `financialFinalizedAt`.
2. Create one immutable courier ledger entry for the platform commission due.
3. Link the entry to the order and courier.
4. Use a deterministic unique source key.
5. Prevent duplicate finalization at database level.
6. Append the completion event.
7. Write the required audit record.

A retry or duplicate worker/API execution must not create another commission entry.

---

# 2. Courier Accounting Design

Do not implement an in-app wallet.

Do not allow generic wallet balance mutation.

Use an append-only courier-accounting ledger.

You may redesign the dormant `Wallet`, `LedgerEntry`, and `Settlement` models if needed, but preserve migration safety.

Prefer clear models such as the following.

## 2.1 Courier Ledger Entry

Create or redesign an immutable ledger entry containing:

- `id`
- `courierId`
- Optional `orderId`
- Optional `settlementPeriodId`
- `type`
- Signed `amountMinor`
- `currency`
- `sourceKey`
- Optional `reversesEntryId`
- Optional `createdByUserId`
- `reason`
- Metadata
- `occurredAt`
- `createdAt`

Ledger entry types:

- `COMMISSION_DUE`
- `EXTERNAL_PAYMENT`
- `ADJUSTMENT_DEBIT`
- `ADJUSTMENT_CREDIT`
- `WAIVER`
- `REVERSAL`

Rules:

- One `COMMISSION_DUE` entry per order.
- `sourceKey` must be globally unique.
- Entries may not be updated or deleted.
- Corrections must use reversal or adjustment entries.
- Currency must be `EGP` for the current MVP.
- Balances must be derived from ledger entries or maintained only as a transactionally verified projection.

Accounting sign convention:

- Positive amount: courier owes more to the platform.
- Negative amount: courier liability is reduced.

Examples:

- Commission due: `+2000`
- External payment: `-1500`
- Waiver: `-500`

## 2.2 Settlement Period

Create settlement periods for each courier.

Default weekly cycle:

- Week starts Monday at `00:00:00` in `Africa/Cairo`.
- Week ends immediately before the next Monday.
- Due date is seven calendar days after period close.
- Use timezone-safe calculations.
- Store absolute timestamps in the database.

Settlement statuses:

- `OPEN`
- `CLOSED`
- `NOT_DUE`
- `DUE_SOON`
- `PARTIALLY_PAID`
- `PAID`
- `OVERDUE`
- `WAIVED`
- `ADJUSTED`

A settlement period must include:

- Courier.
- Period start.
- Period end.
- Due date.
- Currency.
- Total commission due.
- Total payments.
- Total adjustments.
- Total waived.
- Remaining amount.
- Status.
- Version.
- Closed timestamp.
- Created and updated timestamps.

Add settlement lines that link each commission ledger entry to at most one settlement period.

Prevent the same order commission from appearing in multiple settlement periods.

## 2.3 Settlement Closing

Implement an idempotent settlement-closing process.

It may run through the worker and must also be callable safely from an authorized admin command.

The process must:

1. Find completed orders/commission entries in the period.
2. Lock the target period.
3. Add missing settlement lines.
4. Calculate totals from immutable entries.
5. Close the period.
6. Calculate the due date using `Africa/Cairo`.
7. Avoid duplicate lines on retry.
8. Write an audit entry.

Add an idempotent overdue-status process.

A settlement becomes `OVERDUE` when:

- Remaining amount is greater than zero.
- Current Cairo time is after the due date.

Do not suspend the courier automatically in this phase.

The admin may suspend the courier manually.

## 2.4 Manual External Payment

Payments occur outside WASSAL.

The platform only records them.

Allow `finance_admin` and `super_admin` to record an external payment.

Supported informational methods:

- `CASH`
- `BANK_TRANSFER`
- `MOBILE_WALLET_EXTERNAL`
- `OTHER`

Store:

- Courier.
- Amount in minor units.
- Currency.
- Paid-at date.
- Method.
- Optional external reference.
- Optional note.
- Admin actor.
- Idempotency key.
- Created timestamp.
- Optional reversal link.

Rules:

- Partial payments are allowed.
- Overpayments are rejected.
- A payment is allocated to the courier's oldest unpaid settlement first.
- A single payment may cover multiple settlements.
- The sum of allocations must equal the payment amount.
- Allocation and ledger entries must happen in one database transaction.
- Duplicate submissions must not create duplicate payments.
- Payment records must not be edited or deleted.
- Corrections must use a reversal operation.
- Every payment and reversal must have an audit record.

After payment:

- Recalculate affected settlement projections.
- Mark fully paid settlements `PAID`.
- Mark partially paid settlements `PARTIALLY_PAID`.
- Preserve `OVERDUE` where remaining balance still exists after the deadline.

## 2.5 Adjustments and Waivers

Allow only `super_admin` to create:

- Debit adjustment.
- Credit adjustment.
- Waiver.
- Reversal.

Require:

- Amount.
- Reason.
- Optional settlement.
- Optional order.
- Idempotency key.
- Audit actor.

Do not edit the original commission entry or payment.

---

# 3. Required APIs

Follow the current `/api/v1` conventions.

## 3.1 Courier Marketplace

Add:

- `GET /api/v1/couriers/orders/available`
- `GET /api/v1/couriers/orders/available/:orderId`
- `POST /api/v1/couriers/orders/:orderId/accept`
- `GET /api/v1/couriers/orders/current`
- `GET /api/v1/couriers/orders/history`

Available-order endpoints must:

- Be paginated.
- Apply courier eligibility.
- Apply service-zone/city membership.
- Return only privacy-safe pre-acceptance data.
- Sort newest first unless the existing conventions suggest a better deterministic ordering.

Acceptance must require:

- `Idempotency-Key`
- Current order version

## 3.2 Courier Order Lifecycle

Add versioned and idempotent commands for:

- Arriving at pickup.
- Arrived at pickup.
- Picked up.
- In transit.
- Arrived at drop-off.
- Delivered/completed.
- Delivery failed.
- Returning to store.
- Returned/completed.
- Cancel before pickup.

Only the assigned courier may execute courier lifecycle commands.

Admin override commands must remain separate and strongly authorized.

## 3.3 Courier Account

Add:

- `GET /api/v1/couriers/account/summary`
- `GET /api/v1/couriers/account/entries`
- `GET /api/v1/couriers/settlements`
- `GET /api/v1/couriers/settlements/:settlementId`

Summary response must include:

- Accepted orders.
- Completed orders.
- Cancelled orders.
- Returned orders.
- Total completed delivery fees.
- Total returned-order delivery fees.
- Total commission due.
- Total recorded payments.
- Total adjustments.
- Total waived.
- Remaining amount.
- Current/open settlement.
- Latest closed settlement.
- Payment deadline.
- Days remaining.
- Current payment status.

Returned-order delivery fees should report the original delivery fee for returned orders, but must not create a second charge.

## 3.4 Admin Financial Settings

Add:

- `GET /api/v1/admin/financial-settings`
- `PATCH /api/v1/admin/financial-settings`

Only `super_admin` may update settings.

Require the current settings version to prevent lost updates.

Write an audit record for each update.

## 3.5 Admin Courier Accounting

Add:

- `GET /api/v1/admin/courier-accounts`
- `GET /api/v1/admin/couriers/:courierId/account`
- `GET /api/v1/admin/settlements`
- `GET /api/v1/admin/settlements/:settlementId`
- `POST /api/v1/admin/settlements/:settlementId/close`
- `POST /api/v1/admin/couriers/:courierId/external-payments`
- `POST /api/v1/admin/external-payments/:paymentId/reverse`
- `POST /api/v1/admin/couriers/:courierId/adjustments`
- `GET /api/v1/admin/settlements/:settlementId/export.csv`

Support filters for:

- Courier.
- City.
- Service zone.
- Settlement status.
- Date range.
- Overdue only.
- Paid only.
- Remaining amount greater than zero.

Use server-generated CSV from immutable statement lines.

Do not add Excel-specific packages unless already available and justified.

---

# 4. Required Courier Mobile UI

Refactor the courier application after approved verification.

Add authenticated operational navigation with these screens:

## 4.1 Available Orders

Display:

- Pickup store.
- Pickup area.
- Delivery area.
- Distance estimate.
- Duration estimate.
- Package information.
- Delivery fee.
- Estimated courier net.
- Created time.
- Accept button.

Handle:

- Loading.
- Empty state.
- Refresh.
- Pagination.
- Order already taken.
- Ineligible courier.
- Suspended courier.
- Network retry.

## 4.2 Active Order

After acceptance display:

- Full pickup address.
- Full delivery address.
- Authorized contact information.
- Package details.
- Current status.
- Status-action button.
- Navigate to pickup.
- Navigate to delivery.
- Pre-pickup cancellation where allowed.

Use React Native `Linking`.

Do not add location permission.

## 4.3 Order History

Show:

- Completed.
- Cancelled.
- Returned.
- Delivery fee.
- Platform commission.
- Courier net.
- Date.
- Settlement inclusion where available.

## 4.4 Courier Account

Show:

- Completed-order count.
- Returned-order count.
- Cancelled-order count.
- Commission due.
- Payments recorded.
- Remaining balance.
- Current settlement period.
- Period start and end.
- Payment deadline.
- Days remaining.
- Payment status.
- Settlement history.

Use Arabic-first RTL and retain the existing localization architecture.

---

# 5. Required Admin UI

Add role-aware admin pages for:

## 5.1 Financial Settings

Show:

- Current commission percentage.
- Settlement cycle.
- Grace-period days.
- Operations timezone.
- Effective date.
- Settings version.
- History.

Only show update controls to `super_admin`.

Default display must be:

- Commission: 20%.
- Cycle: Weekly.
- Grace period: 7 days.
- Timezone: Africa/Cairo.

## 5.2 Courier Accounts

Show a table containing:

- Courier.
- City/service zone.
- Completed orders.
- Returned orders.
- Cancelled orders.
- Commission due.
- Paid.
- Remaining.
- Current deadline.
- Status.
- Suspended state.

## 5.3 Courier Statement

Show:

- Settlement periods.
- Orders included.
- Commission entry per order.
- Payments.
- Payment allocations.
- Adjustments.
- Waivers.
- Reversals.
- Remaining balance.
- Audit history.

## 5.4 Record External Payment

Form fields:

- Amount.
- Paid-at date.
- Payment method.
- External reference.
- Note.
- Idempotent submission.

Show the allocation preview or result across oldest unpaid settlements.

## 5.5 Admin Actions

Add:

- Manual settlement close.
- Payment reversal.
- Debit/credit adjustment.
- Waiver.
- Manual courier suspension.
- Courier reactivation.
- CSV export.

Hide actions that the current role cannot perform.

Do not rely only on backend authorization.

---

# 6. Merchant Application Changes

Keep the existing quote and order-creation flow.

Do not add courier selection.

Extend order tracking to display operational status:

- Searching for courier.
- Courier assigned.
- Courier arriving.
- At pickup.
- Picked up.
- In transit.
- At drop-off.
- Delivered.
- Delivery failed.
- Returning to store.
- Returned.
- Completed.
- Cancelled.

Do not expose:

- Courier platform commission.
- Courier settlement balance.
- Courier payment deadline.
- Courier account statement.

Only expose the minimum courier identity/contact information required by the product after assignment.

---

# 7. Database and Migration Requirements

Create one new safe migration.

The migration must:

- Preserve all existing Phase 1 and Phase 2 data.
- Relax or replace `DeliveryOrder_phase2_scope_check`.
- Allow courier assignment and later lifecycle statuses.
- Add `COMPLETED`.
- Add required typed event types.
- Add courier operating-zone membership.
- Add typed commission-basis-point snapshots.
- Add versioned platform financial settings.
- Add or redesign immutable ledger structures.
- Add settlement periods and lines.
- Add external payments and allocations.
- Add reversals, adjustments, and waivers.
- Add required indexes and unique constraints.
- Add append-only update/delete triggers where appropriate.
- Add database checks for money, currency, dates, rates, totals, and status consistency.

Important constraints:

- One commission entry per order.
- One accepted courier per order.
- One settlement line per commission ledger entry.
- Unique idempotency/source keys.
- One reversal per original entry/payment.
- Period start earlier than period end.
- Period end not after due date.
- Nonnegative payment amount.
- No over-allocation.
- EGP currency consistency.
- Commission basis points between 0 and 10000.

Do not delete dormant tracking tables.

Do not create payment-provider tables.

---

# 8. Authorization Requirements

Extend RBAC using explicit permissions.

Recommended permissions:

- Courier available-order read.
- Courier order accept.
- Courier assigned-order read.
- Courier lifecycle update.
- Courier own-account read.
- Courier own-settlement read.
- Finance settings read.
- Finance settings update.
- Courier accounts read.
- Settlements read.
- Settlements close.
- External payments create.
- External payments reverse.
- Adjustments create.
- Waivers create.
- Financial exports create.

Role policy:

- Courier: own marketplace, orders, account, and statements only.
- Merchant: own merchant orders only.
- Support agent: limited operational order read; no financial mutations.
- Operations admin: order operations; no payment or setting mutation by default.
- Finance admin: courier accounts, settlements, and external-payment recording.
- Super admin: all financial settings, reversals, adjustments, and waivers.

Add ownership isolation tests.

---

# 9. Testing Requirements

Do not consider the phase complete without tests.

## 9.1 Unit Tests

Add tests for:

- Courier eligibility.
- Service-zone membership.
- Allowed status transitions.
- Rejected status transitions.
- Commission 20% example.
- Basis-point rounding.
- Historical commission snapshot.
- Settlement-period Cairo date boundaries.
- Remaining-balance calculation.
- Partial payment.
- Overpayment rejection.
- Oldest-settlement allocation.
- Waiver.
- Adjustment.
- Reversal.
- Days remaining.
- Overdue status.

## 9.2 Database Integration Tests

Test:

- One courier assignment under concurrent updates.
- One commission ledger entry per completed order.
- Immutable ledger records.
- Immutable payment records.
- Unique settlement lines.
- Unique payment idempotency keys.
- Unique reversal links.
- Transaction rollback consistency.
- Currency constraints.
- Settlement date constraints.

## 9.3 E2E Tests

Create a complete Phase 3 journey:

1. Admin config defaults to 20%.
2. Approved courier belongs to the correct zone.
3. Merchant creates quote.
4. Quote uses 20% commission.
5. Merchant creates order.
6. Courier sees the safe marketplace card.
7. Multiple couriers attempt acceptance simultaneously.
8. Exactly one courier succeeds.
9. Losing couriers receive 409.
10. Winning courier sees full details.
11. Courier progresses through pickup and delivery.
12. Order becomes completed.
13. Exactly one commission ledger entry is created.
14. Settlement period includes the commission.
15. Finance admin records a partial external payment.
16. Settlement becomes partially paid.
17. Finance admin records the remaining payment.
18. Settlement becomes paid.
19. Courier account totals reconcile.
20. Merchant cannot see courier financial data.
21. Courier cannot see another courier's account.
22. Operations admin cannot change global commission.
23. Finance admin cannot waive unless explicitly permitted.
24. No payment-provider call is made.
25. No courier-location permission or location upload exists.

Add a separate returned-order E2E journey.

Add a pre-pickup courier cancellation and reassignment journey.

## 9.4 Concurrency Test

Run at least 10 concurrent acceptance requests against one order using different eligible couriers.

Assert:

- Exactly one HTTP success.
- All others receive 409.
- One assigned courier.
- One acceptance event.
- One assignment audit record.
- No accepted `DispatchOffer` is required.
- Order version is incremented correctly.

---

# 10. Seed and Demo Data

Update the seed with deterministic demo data:

- Platform settings with 20% commission.
- Weekly settlement cycle.
- Seven-day grace period.
- Africa/Cairo timezone.
- At least two service zones.
- At least three approved couriers.
- At least two couriers eligible for the same zone.
- One suspended courier.
- Available orders.
- Assigned order.
- Completed order.
- Returned order.
- Open settlement.
- Partially paid settlement.
- Paid settlement.
- Overdue settlement.
- External payment records.
- Adjustment and waiver examples.

Do not seed real credentials or external secrets.

---

# 11. Documentation

Update or create documentation for:

- Phase 3 architecture.
- Marketplace privacy rules.
- Atomic acceptance algorithm.
- Order lifecycle.
- Return policy.
- Commission-snapshot policy.
- Courier ledger sign convention.
- Settlement-cycle calculation.
- External-payment workflow.
- RBAC matrix.
- API examples.
- Recovery and reconciliation.

Clearly state:

- No live tracking.
- No background GPS.
- No payment gateway.
- No automatic payout.
- Payments are recorded only after occurring outside the application.
- Distance is currently an offline estimate rather than road-network routing.

---

# 12. Verification Commands

Run all repository-standard checks.

At minimum:

- Formatting.
- Type checking.
- Linting.
- Unit tests.
- Database integration tests.
- E2E tests.
- Production builds for API, worker, merchant web, admin web, and courier mobile where supported.
- Prisma validation.
- Migration application on a clean database.
- Seed execution.
- Migration upgrade test from the existing Phase 2 schema.
- Search confirming no `expo-location`, tracking gateway, or payment gateway was introduced.

Do not suppress failing tests.

Do not use `any`, unsafe casts, or disabled lint rules to bypass errors.

---

# 13. Implementation Discipline

- Inspect existing code before creating new abstractions.
- Reuse existing idempotency, audit, RBAC, transaction, and error-response patterns.
- Keep the modular monolith.
- Do not add microservices.
- Do not add unnecessary dependencies.
- Do not implement payment providers.
- Do not implement tracking.
- Do not perform broad unrelated refactors.
- Preserve Arabic RTL and English localization.
- Keep money as integer minor units.
- Use database constraints as the final integrity boundary.
- Use append-only financial records.
- Use reversals rather than destructive edits.
- Keep all commands safe under retries and concurrent execution.
- Do not claim completion when only UI mocks or dormant models exist.

---

# 14. Required Completion Report

After implementation, create:

`docs/phase-3-implementation-report.md`

The report must include:

1. Executive summary.
2. Product decisions implemented.
3. Database changes.
4. Migration name.
5. New and modified files.
6. New APIs.
7. New courier screens.
8. New admin screens.
9. Marketplace concurrency design.
10. Commission calculation design.
11. Settlement and payment design.
12. RBAC changes.
13. Test coverage.
14. Verification commands and exact results.
15. Remaining limitations.
16. Deferred future features.
17. Updated MVP implementation percentage.

Print a concise terminal summary containing:

- Migration applied.
- Number of tests passed.
- Build results.
- Marketplace race-test result.
- Default commission.
- Settlement cycle and grace period.
- Confirmation that tracking was not added.
- Confirmation that payment integration was not added.
- Exact report path.

Do not stop after planning.

Implement the phase, migrate the database, update the applications, run the full verification suite, fix all failures caused by this work, and produce the final implementation report.
