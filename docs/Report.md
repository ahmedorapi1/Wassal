# WASSAL MVP Location, Orders, Pricing, and Courier Accounting Audit

**Audit date:** 2026-07-26  
**Scope:** Current repository worktree, including its uncommitted Phase 1/Phase 2 changes  
**Audit mode:** Read-only; no production code, configuration, schema, migration, seed, test, or existing documentation was changed

## 1. Executive Summary

WASSAL currently has a solid early-order and pricing foundation, but it is not yet an end-to-end delivery or courier-accounting MVP.

The implemented order journey is merchant-only: a merchant records customer and coordinate data, the API validates both points against a PostGIS service zone, an offline deterministic maps adapter estimates distance and duration, a versioned pricing rule creates an immutable quote, and the quote is confirmed into an order whose terminal active Phase 2 state is `SEARCHING_COURIER`. The merchant does not select a courier. Each implemented state transition is accompanied by an append-only `OrderEvent`, and quote confirmation/cancellation use transactions, row locks, versions, and idempotency.

The required courier marketplace does not exist. There is no courier available-orders endpoint, screen, eligibility query, acceptance command, active-order screen, external-navigation button, pickup/delivery workflow, or returned-order workflow. A Phase 2 database check requires every order to remain in `DRAFT`, `QUOTED`, `SEARCHING_COURIER`, or `CANCELLED` and requires `courierId` to be null. `DispatchOffer`, `TrackingPoint`, and later order statuses are future-facing schema, not implemented behavior.

The location MVP is comparatively close to the requested product decision. Neither client requests GPS permission; no location is uploaded by the courier; no WebSocket/SSE tracking exists; the worker performs no location jobs; and no map is embedded. Store and delivery coordinates are manually entered or loaded from saved addresses. Route distance is an offline Haversine-based estimate multiplied by a fixed road factor, not a routing API. This is zero-cost and deterministic, but it is not road-network distance and must be explicitly accepted as the MVP commercial-distance policy or redesigned before production billing.

Pricing is genuinely implemented. It uses integer EGP minor units, versioned rules, deterministic half-up rounding, backend-authoritative route estimates, PostGIS zone selection, immutable quote/order snapshots, and database financial checks. The active seed is 15% commission, not the required 20%. Commission configuration is embedded in each `PricingRule`; there is no `PlatformSettings` record or global default commission setting. `platformCommissionMinor` and `estimatedCourierEarningMinor` are snapshotted at quote and order creation, but no courier liability is recognized in a ledger at delivery/completion.

The schema contains `Wallet`, `LedgerEntry`, and `Settlement`, but no API, service, worker, seed, test, or UI uses them. They are dormant foundation tables. There is no payment gateway or payment-provider adapter in application composition, which correctly avoids in-app payment processing and real payment costs. There is also no manual external-payment record, settlement line, due date, grace period, overdue calculation, partial-payment allocation, waiver, adjustment workflow, or courier statement.

The highest-priority implementation sequence is therefore:

1. preserve the no-tracking MVP boundary;
2. implement eligible available orders and atomic courier acceptance;
3. add an explicit typed 20% platform-setting/rate snapshot while preserving historical orders;
4. recognize commission once at a defined financially final status;
5. add append-only courier accounting, settlements, and manual external-payment records;
6. expose audited admin and courier account screens.

Overall Location and Finance MVP readiness is **24/100**. Location boundaries and pricing are useful foundations; marketplace acceptance and the complete financial-accounting workflow are production blockers.

## 2. Current Location Implementation

### 2.1 Findings

| Question                                     | Current evidence-based answer                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the application use courier GPS?        | No. `apps/courier-mobile/package.json` has no `expo-location` dependency, `apps/courier-mobile/app.json` declares no location permission, and `apps/courier-mobile/App.tsx` contains no location API.                                             |
| Are location permissions requested?          | No in courier or merchant applications. The courier app requests photo-library access only for verification documents. The merchant web app cannot request background GPS and uses manual coordinate fields.                                      |
| Is live courier tracking implemented?        | No. There is no tracking controller/service, gateway, client subscription, map projection, or tracking UI.                                                                                                                                        |
| Is courier location sent to the backend?     | No endpoint accepts it and the courier client never sends it.                                                                                                                                                                                     |
| Are courier coordinates stored continuously? | No. `CourierProfile.lastLocation`, `CourierProfile.lastLocationAt`, and `TrackingPoint` exist in `infrastructure/database/prisma/schema.prisma`, but no non-generated TypeScript code reads or writes them.                                       |
| Is movement history modeled?                 | Schema only: `TrackingPoint` stores `courierId`, `orderId`, PostGIS point, accuracy, heading, speed, capture time, and indexes. It is unused.                                                                                                     |
| Is real-time transport used?                 | No application WebSocket, Socket.IO, SSE, or `EventSource` implementation exists. `ws` occurrences in `pnpm-lock.yaml` are transitive development/framework dependencies, not WASSAL tracking code.                                               |
| Does the worker process location?            | No. `apps/worker/src/main.ts` only connects Redis and opens the empty `wasel-foundation` BullMQ queue. It registers no `Worker`, processor, repeatable job, cron, or scheduler.                                                                   |
| Are maps embedded?                           | No. `apps/merchant-web/app/merchant-app.tsx` presents latitude/longitude inputs inside a visually named `map-input`; its own text says a map provider may replace it later. Admin and courier clients have no map.                                |
| Which map provider is used?                  | `DeterministicLocalMapsProvider` in `packages/providers/src/local-maps.provider.ts`, injected under `MAPS_PROVIDER` in `apps/api/src/app.module.ts`. It makes no network request.                                                                 |
| How is distance calculated?                  | `DeterministicLocalMapsProvider.route()` calculates great-circle/Haversine distance, multiplies it by `1.23`, rounds to meters, and derives duration at a fixed 24 km/h. It is not Google Maps, Mapbox, HERE, OSM routing, or a road-network API. |
| Is geocoding implemented?                    | The `MapsProvider.geocode()` port exists in `packages/providers/src/interfaces.ts`; the local implementation deliberately throws. Users must provide validated coordinates.                                                                       |
| How are zones resolved?                      | `OrdersService.resolveZone()` in `apps/api/src/orders/orders.service.ts` uses PostGIS `ST_Covers` to require pickup and drop-off inside one active `ServiceZone`.                                                                                 |
| Can an external navigation app be opened?    | Not currently. `apps/courier-mobile/App.tsx` does not use React Native `Linking`, `geo:` URIs, Google Maps URLs, or another navigation scheme.                                                                                                    |

### 2.2 Models, migrations, endpoints, variables, flags, and tests

- `Store.location`: PostGIS `geography(Point, 4326)` in `infrastructure/database/prisma/schema.prisma`.
- `Address.latitude`, `Address.longitude`, `Address.location`: exact coordinates plus PostGIS point.
- `ServiceZone.boundary`: PostGIS `geography(MultiPolygon, 4326)` with `ServiceZone_boundary_gist`.
- `CourierProfile.lastLocation` and `lastLocationAt`: dormant future fields.
- `TrackingPoint`: dormant future movement-history table with `TrackingPoint_location_gist`, order/time, and courier/time indexes.
- `OrderEvent.location` and `ProofOfDelivery.location`: dormant optional location fields.
- Migration evidence:
  - `infrastructure/database/prisma/migrations/20260723004942_phase_0_foundation/migration.sql` enables PostGIS and creates spatial indexes.
  - `infrastructure/database/prisma/migrations/20260723160000_phase_2_orders_pricing_zones/migration.sql` adds service-zone geometry, coordinate checks, point-consistency checks, and boundary validity checks.
- Location-writing endpoints:
  - `POST /api/v1/merchants/current/stores`
  - `PATCH /api/v1/merchants/current/stores/:storeId`
  - `POST /api/v1/merchant/customers/:customerId/addresses`
  - `PATCH /api/v1/merchant/customers/:customerId/addresses/:addressId`
  - `POST /api/v1/orders/quotes` consumes stored/manual coordinates and calculates a route estimate.
- Admin zone endpoints are in `apps/api/src/admin/phase-two-admin.controller.ts`; only `super_admin` can mutate zones.
- No location-specific environment variable or API key exists in `.env.example` or `packages/config/src/env.ts`.
- No live-tracking feature flag exists. The five seeded flags are `cash_on_delivery`, `surge_pricing`, `scheduled_deliveries`, `multi_stop_delivery`, and `subscriptions`.
- Tests:
  - `packages/providers/src/local-maps.provider.test.ts`: deterministic route and invalid-coordinate rejection.
  - `packages/validation/src/phase-two.test.ts`: Egypt coordinate boundary validation.
  - `apps/api/src/orders/order-domain.test.ts`: local polygon containment.
  - `apps/api/src/phase-two.e2e.test.ts`: saved PostGIS address and deterministic quote journey.

### 2.3 Comparison with the MVP location decision

| Component                                                            | Classification                                                                    | Reason and action                                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| No courier GPS permission or upload                                  | Keep for MVP                                                                      | Exactly matches the requested no-live-tracking boundary.                                                         |
| `Store`/`Address` coordinates and PostGIS points                     | Keep for MVP                                                                      | Required for coverage and distance estimation; data is entered intentionally rather than collected continuously. |
| `ServiceZone` PostGIS polygons                                       | Keep for MVP                                                                      | Provides deterministic city/zone eligibility without courier surveillance.                                       |
| `MapsProvider` port                                                  | Keep for MVP                                                                      | Maintains vendor independence and makes future routing replaceable.                                              |
| `DeterministicLocalMapsProvider`                                     | Keep for MVP only after product acceptance; redesign before road-accurate billing | Zero cost and tested, but `1.23 ×` straight-line distance is an estimate, not a real route.                      |
| Manual merchant coordinate fields                                    | Redesign before broad merchant use                                                | Technically works, but coordinates are not a usable address-selection experience for typical merchants.          |
| External-navigation launch                                           | Keep for future implementation in the immediate marketplace phase                 | It meets the desired MVP without tracking and needs only a deliberate URI/URL allowlist.                         |
| `CourierProfile.lastLocation*`                                       | Remove from MVP scope; keep for future implementation                             | Dormant fields must not gain writers in the MVP.                                                                 |
| `TrackingPoint` table and GiST indexes                               | Remove from MVP scope; keep for future implementation                             | Schema exists but should remain unused; no tracking API or worker should be introduced.                          |
| `OrderEvent.location`, `ProofOfDelivery.location`                    | Keep for future implementation                                                    | Do not require location for MVP status changes or proof.                                                         |
| `DispatchOffer.distanceToPickupMeters`                               | Redesign before use                                                               | Courier selection should use configured service area/city, not live proximity.                                   |
| Tracking WebSockets/SSE, background GPS, live ETA, admin courier map | Remove from MVP scope                                                             | None exists; keep them absent.                                                                                   |

## 3. Current Order Assignment Flow

### 3.1 Implemented flow

1. Merchant owner, manager, or staff calls `POST /api/v1/orders/quotes`.
2. `OrdersService.createQuote()` resolves or creates a merchant-owned customer/address, resolves the active store, verifies a shared `ServiceZone`, calculates a deterministic route estimate, selects one active `PricingRule`, calculates the price, and stores a versioned `PriceQuote`.
3. The same merchant roles call `POST /api/v1/orders` with only `{ quoteId }`. There is no courier field.
4. In a serializable transaction, `OrdersService.createOrder()`:
   - claims durable idempotency;
   - locks the quote with `FOR UPDATE`;
   - verifies quote, store, merchant, and zone;
   - creates exactly one `DeliveryOrder`;
   - copies customer, address, package, route, pricing, rate-derived amounts, currency, and rule version;
   - creates four `OrderEvent` rows;
   - consumes the quote;
   - writes an `AuditLog`.
5. The order immediately reaches `SEARCHING_COURIER`, but nothing searches for or displays it to couriers.

Evidence is in:

- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/order-domain.ts`
- `apps/merchant-web/app/merchant-app.tsx`
- `apps/api/src/phase-two.e2e.test.ts`
- `docs/architecture/phase-2-order-domain.md`

### 3.2 Assignment and marketplace findings

- Merchant courier selection: **not implemented**, which matches the required default workflow.
- Automatic assignment: **not implemented**.
- All-courier marketplace: **not implemented**.
- City/zone courier filtering: **not implemented**. Zone validation applies to the order route, not courier eligibility.
- Radius/distance-to-courier filtering: **not implemented**.
- Bidding: **not implemented**.
- Courier offers: schema only through `DispatchOffer`; no API/service/worker/UI uses it.
- Courier acceptance: **not implemented**.
- Courier authorization to Phase 2 order routes: explicitly denied. `OrdersController` is merchant-only, and `apps/api/src/phase-two.e2e.test.ts` expects a courier GET to return 403.

### 3.3 Statuses and history

`OrderStatus` in `infrastructure/database/prisma/schema.prisma` declares:

`DRAFT`, `QUOTED`, `SEARCHING_COURIER`, `COURIER_ASSIGNED`, `COURIER_ARRIVING_PICKUP`, `AT_PICKUP`, `PICKED_UP`, `IN_TRANSIT`, `AT_DROPOFF`, `DELIVERED`, `DELIVERY_FAILED`, `RETURNING_TO_STORE`, `RETURNED`, and `CANCELLED`.

Only `DRAFT`, `QUOTED`, `SEARCHING_COURIER`, and `CANCELLED` are executable. `DeliveryOrder_phase2_scope_check` in the Phase 2 migration rejects all later states, rejects non-`DELIVERY_ONLY` payment mode, and requires `courierId IS NULL`.

`allOrderTransitions` in `apps/api/src/orders/order-domain.ts` describes a future state graph. `phaseTwoTransitions` is the enforced code policy. This distinction is tested in `apps/api/src/orders/order-domain.test.ts`, including an assertion that `SEARCHING_COURIER → COURIER_ASSIGNED` is false.

Current transitions are recorded in append-only `OrderEvent` rows. `OrderEvent_immutable` rejects update/delete. The current `OrderEventType` enum only covers draft, quote, confirmation/search, cancellation, and note/quote events; it lacks acceptance, pickup, delivery, failure, and return event types.

### 3.4 Concurrency and cancellation

Existing concurrency protection applies to quote confirmation and early cancellation, not courier acceptance:

- `PriceQuote.merchantId + idempotencyKey` unique constraint.
- `DeliveryOrder.quoteId` unique constraint.
- `IdempotencyRecord(scope, key)` unique constraint.
- Serializable transactions and `FOR UPDATE`.
- `DeliveryOrder.version` optimistic update for cancellation.
- `apps/api/src/phase-two.e2e.test.ts` concurrently confirms one quote twice and proves both calls return one order.

Foundation schema contains useful future acceptance constraints:

- `DispatchOffer(orderId, courierId)` is unique.
- Partial unique index `DispatchOffer_one_accepted_per_order` allows at most one accepted offer per order.

These do not make acceptance safe because no acceptance command exists and the Phase 2 order check forbids assignment.

Merchant owner/manager and operations/super admin can cancel only while status is `DRAFT`, `QUOTED`, or `SEARCHING_COURIER` and `courierId` is null. The command uses a row lock, version condition, idempotency, an `OrderEvent`, and an `AuditLog` in one transaction. Staff cannot cancel.

Cancellation after acceptance/pickup, courier cancellation, reassignment, failure, and compensation are not implemented. Return statuses exist only in the enum/future transition table. There is no return command, return order, return fee calculation, or return event.

### 3.5 Required MVP comparison

- Merchant creates order: implemented.
- Order becomes technically `SEARCHING_COURIER`: implemented, but not exposed.
- Couriers choose orders: not implemented.
- First successful acceptance wins: not implemented.
- No merchant-selected courier: implemented.
- Admin manual assignment: not implemented and correctly deferred.
- Duplicate acceptance prevention: partial schema foundation only.
- Every current transition recorded: implemented for the limited Phase 2 flow; later events are not modeled.

## 4. Current Pricing Logic

### 4.1 How price is determined

The merchant does not enter a delivery fee. The merchant enters/selects pickup store, customer/drop-off coordinates, package size/weight/count, declared value, and flags such as fragile/thermal bag.

`OrdersService.createQuote()` performs backend calculation:

1. resolve one service zone containing pickup and drop-off;
2. estimate distance/duration with `DeterministicLocalMapsProvider`;
3. resolve a zone-specific or city-level active motorcycle `PricingRule`;
4. call `calculatePrice()` in `apps/api/src/orders/order-domain.ts`.

The formula uses:

- base fee;
- included distance;
- per-kilometer charge on remaining meters;
- minimum fee;
- package-size surcharge;
- weight-band surcharge;
- fragile surcharge;
- thermal-bag surcharge;
- discount fixed to zero;
- surge fixed to zero;
- tax basis points;
- percentage or fixed commission.

Percentage and tax ratios use deterministic integer half-up rounding through `roundRatio()`. Monetary quote/order columns are `Int` minor units, not float. Currency is stored and database checks currently require `EGP`.

### 4.2 Zone, return, surge, and provider behavior

- Pricing is country/governorate/city plus optional `serviceZoneId`, vehicle type, priority, version, and effective range.
- A zone-specific rule outranks a city fallback.
- Admin activation detects ambiguous same-scope/same-priority effective overlaps.
- `returnTripBaseMinor` and `waitingFeePerMinuteMinor` exist on `PricingRule`, but neither is included in `PricingRuleSnapshot` nor used by `calculatePrice()`.
- `surgeAdjustmentMinor` exists but is always zero and database checks enforce zero.
- `surge_pricing` is seeded false but no runtime feature-flag service reads it.
- No routing API is called.

### 4.3 Snapshots and historical safety

`PriceQuote` stores:

- selected pricing rule and version;
- route, parties, address, and package snapshots;
- every monetary component;
- `platformCommissionMinor`;
- `estimatedCourierEarningMinor`;
- currency and breakdown JSON.

`DeliveryOrder` copies these values and adds `pricingVersion` and `pricingSnapshot`. The `PriceQuote_snapshot_immutable` and `DeliveryOrder_snapshot_immutable` triggers prevent historical-field update/delete. A quote can be recalculated only by creating a replacement quote. A pricing edit creates a new `PricingRule` version. Old orders therefore do not change when a new rule is created or activated.

### 4.4 Admin pricing

Backend:

- Read: support, operations, finance, super admin.
- Create/version/activate/deactivate/validate overlaps: super admin only.
- Routes are in `apps/api/src/admin/phase-two-admin.controller.ts`.
- Logic and audit writes are in `apps/api/src/admin/phase-two-admin.service.ts`.

UI:

- `apps/admin-web/app/admin-app.tsx` lists rule versions and lets a user create a draft with base fee, per-kilometer fee, minimum, priority, and commission basis points.
- The “new version” button currently copies a rule and changes only `effectiveFrom`; it does not provide a full edit form for overrides.
- Mutation controls are rendered without inspecting the logged-in role, so a non-super admin can see them but the API rejects the mutation.
- Commission is part of a pricing rule, not a global platform setting.

### 4.5 Numerical evidence

Seed example in `infrastructure/database/prisma/seed.ts`:

- active rule version 2;
- base fee: `1500` minor = EGP 15.00;
- included distance: 1 km;
- per km: `500` minor = EGP 5.00;
- minimum: `2000` minor = EGP 20.00;
- medium package: EGP 2.00;
- fragile: EGP 2.50;
- commission: `1500` basis points = 15%;
- 3 km seeded route produces merchant total `2950` = EGP 29.50;
- commission `443` = EGP 4.43 after half-up rounding;
- estimated courier earning `2507` = EGP 25.07.

Test example in `apps/api/src/orders/order-domain.test.ts`:

- 3,501 meters, medium, 6 kg, fragile, thermal bag;
- total `3751` = EGP 37.51;
- 15% commission `563` = EGP 5.63;
- estimated courier earning `3188` = EGP 31.88.

The required default is 20%, so current seed, UI defaults, and tests do not meet the product requirement.

## 5. Current Financial Architecture

### 5.1 Implemented pricing-related financial data

| Item                  | Current state                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Order price           | Real, backend-calculated, integer minor units, snapshotted.                                      |
| Commission amount     | Real estimate on quote/order in `platformCommissionMinor`.                                       |
| Courier net estimate  | Real estimate on quote/order in `estimatedCourierEarningMinor`.                                  |
| Exact rate            | Present in the selected `PricingRule` and breakdown JSON, but not a dedicated typed order field. |
| Historical protection | Real database trigger prevents changing financial snapshot fields.                               |
| Liability recognition | Not implemented. No ledger entry is created at delivery/completion.                              |

`Merchant.commissionRate` is `Decimal(5,4)` and seeded `0.1500`, but no service uses it for order pricing or accounting. It is a separate unused value and creates ambiguity with `PricingRule.commissionValue`.

### 5.2 Dormant foundation tables

The following models are real database tables but have no application behavior:

#### `Wallet`

- `ownerType`: `MERCHANT`, `COURIER`, or `PLATFORM`.
- `ownerId`, currency, mutable `Decimal(14,2)` balance, version.
- Unique owner/type/currency.
- No FK from `ownerId` to a merchant/courier.
- No service, endpoint, UI, seed, test, or worker.

#### `LedgerEntry`

- Links to `Wallet`, optionally `DeliveryOrder`.
- Types: `DELIVERY_FEE`, `COURIER_EARNING`, `PLATFORM_COMMISSION`, `CASH_COLLECTED`, `SETTLEMENT`, `ADJUSTMENT`, `REFUND`.
- Exact `Decimal(14,2)` amount and currency.
- Globally unique `idempotencyKey`.
- Database trigger forbids update/delete.
- No actor, settlement allocation, reversal link, payment method, due date, or application code.

#### `Settlement`

- Owner type/id, exact decimal amount, currency, status, period start/end, optional completion time, metadata.
- Statuses: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`.
- No line items, due date, grace period, amount paid, remaining balance, payment status, notes, actor, unique period constraint, or relation to ledger/payments.
- No application code.

These tables are schema placeholders, not a wallet, ledger, or settlement feature a user can access.

### 5.3 Payment providers and integrations

- `PaymentProvider` is only an interface in `packages/providers/src/interfaces.ts`.
- No `PAYMENT_PROVIDER` token exists in `apps/api/src/infrastructure/tokens.ts`.
- `apps/api/src/app.module.ts` does not bind a payment adapter.
- No Stripe, Paymob, Fawry, card SDK, payout provider, bank API, webhook, payment key, or payment environment variable exists.
- No payment, payout, withdrawal, top-up, refund, invoice, or external-payment endpoint exists.
- `PaymentMode.CASH_ON_DELIVERY` exists in schema, but the Phase 2 check forces `DELIVERY_ONLY`.
- `cash_on_delivery` is seeded disabled and appears in contracts, but no runtime flag evaluator exists.

This correctly avoids real payment processing and provider costs, but it also means manual accounting is absent.

### 5.4 Complexity assessment

`Wallet`, generic `Settlement`, payment/notification/phone-masking interfaces, COD enums/columns, tracking models, and dispatch models were created as a broad foundation. Because they are unused, they do not currently create runtime cost, but they can mislead reviewers into believing features exist. Financial implementation should redesign the dormant wallet/settlement shape before use instead of exposing generic CRUD over it.

## 6. Current Courier Accounting

No courier-accounting service, API, read model, or UI exists.

Current courier fields:

- `CourierProfile.completedOrdersCount`: default zero and never updated.
- `CourierProfile.cashLimit`: exact decimal, never used.
- `CourierProfile.availability`: remains onboarding/future state; no availability endpoint.
- `DeliveryOrder.courierId`: forced null by the Phase 2 database constraint.

Therefore WASSAL currently cannot calculate or show:

- accepted/completed/cancelled/returned order counts per courier;
- completed delivery fees;
- return value;
- commission due;
- externally paid amount;
- remaining amount;
- settlement dates/deadline/days remaining/payment status;
- statements, waivers, adjustments, or partial payments.

### 6.1 Financial completion

There is no `COMPLETED` order status. `DELIVERED` exists in the enum but cannot be reached. Commission is calculated at quote creation and copied at order creation, when no courier is assigned. It is an estimate/snapshot, not a finalized receivable.

The safest design separates:

1. **rate snapshot** at quote/order creation, so later setting changes cannot alter the order;
2. **liability recognition** once, at a deliberately selected financially final status.

Recommendation: add an explicit `COMPLETED` financial-finalization transition after delivery/return policy is resolved, and create the commission ledger entry in the same transaction. If the product deliberately treats `DELIVERED` as final, then recognize it at `DELIVERED`; do not recognize at acceptance or pickup. This is a product decision because the return and cancellation consequences are not defined.

### 6.2 Cancellation and returns

- Current pre-assignment cancellation leaves the snapshot on the cancelled order but creates no liability, because no ledger exists.
- Courier cancellation is not implemented.
- Cancellation after pickup is not implemented.
- Return states exist, but no behavior exists.
- `returnTripBaseMinor` is unused and seeded zero.
- A return does not create a fee, reverse commission, or create a ledger entry.

Reasonable product options, without selecting policy:

| Decision            | Option                             | Consequence                                                                                     |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Return pricing      | New separately priced return leg   | Clearest courier compensation and audit, but customer/merchant liability rules must be defined. |
| Return pricing      | Fixed return fee on original order | Simpler UI, but original and return economics share one aggregate.                              |
| Return pricing      | No paid return                     | Simplest accounting but may be operationally unfair to courier.                                 |
| Original commission | Keep original commission           | Platform earns on completed outbound service even if returned later.                            |
| Original commission | Reverse original commission        | Requires an immutable reversal entry and clear return-finalization event.                       |
| Original commission | Adjust case-by-case                | Requires authorized adjustment/waiver controls and stronger audit policy.                       |

### 6.3 Adjustments and statements

The `LedgerEntryType` enum includes `ADJUSTMENT` and `REFUND`, and immutable ledger triggers are useful foundations. There is no command that creates them, no reversal link, no actor, and no account statement query. Waivers and partial payments have no model.

## 7. Current Admin Capabilities

### 7.1 Fully implemented

- Phase 2 dashboard: orders today, current Phase 2 status counts, cancelled count, quote conversion, expired quotes, orders by zone.
- Order list/detail, immutable snapshots, event timeline, audit history, and eligible early cancellation.
- Service-zone list/create/update/activate/deactivate.
- Pricing-rule list/create draft/create version/activate/deactivate/overlap validation.
- Courier verification list/detail/document review/approval/rejection/suspension/reactivation.
- Courier verification and audit histories.
- Merchant list/detail.
- User status changes with session revocation and audit.

Files:

- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/admin/phase-two-admin.controller.ts`
- `apps/api/src/admin/phase-two-admin.service.ts`
- `apps/admin-web/app/admin-app.tsx`

### 7.2 Partially implemented

- **Commission configuration:** super admin can create a pricing rule containing commission basis points. This is not a global 20% platform setting and has no dedicated setting history.
- **Courier suspension/reactivation:** implemented for verification/account status, but not tied to overdue settlements or active-order safeguards.
- **Order filters:** API supports order number, merchant, store, customer phone, status, zone, cancellation reason, and dates; the admin UI does not expose these controls.
- **Audit:** strong for current admin/order/pricing/verification commands, but there are no financial commands to audit.

### 7.3 UI-only or misleading

- Pricing mutation controls are visible regardless of logged-in admin role; the backend correctly limits mutations to `super_admin`.
- The merchant coordinate section is styled as a map input but contains only text boxes and explicitly says a provider is future work.

### 7.4 Backend-only

- Rich admin order filtering.
- Pricing version overrides can be supplied to the API, while the current “new version” UI only changes `effectiveFrom`.
- `support_agent`, `operations_admin`, `finance_admin`, and `super_admin` can read Phase 2 orders/zones/pricing through backend role rules.

### 7.5 Not implemented

- Global commission percentage.
- Grace period or accounting-cycle setting.
- Courier order counts or earnings/commission summary.
- Completed/cancelled/returned counts per courier.
- Commission receivable or overdue balances.
- Courier statement or settlement detail.
- Manual/partial external payment.
- Payment allocation, reversal, adjustment, or waiver.
- Settlement notes.
- Settlement/courier financial filters.
- CSV/Excel export.
- Financial suspension automation.

## 8. External Services and Expected Costs

No paid external API is currently configured or called by production code in this repository.

| Service                             | Purpose                                                      | Current usage                                                                              | Required for MVP                          | Pricing risk                  | Recommended MVP action                                                                            |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| PostgreSQL + PostGIS                | Durable operational, spatial, audit, and future finance data | Local `postgis/postgis:18-3.6` container; managed production deployment is only documented | Yes                                       | Medium                        | Keep. Select one managed provider and monitor storage, connections, backups, and PostGIS support. |
| Redis                               | Rate limiting and BullMQ foundation                          | Local Redis container; API rate limits use it; worker only connects                        | Yes for current implementation            | Low to Medium                 | Keep a small managed instance or simplify rate limiting if deployment scale permits.              |
| Local filesystem object storage     | Courier verification documents                               | `LocalObjectStorageProvider`; no external charge                                           | Development only                          | None                          | Keep local only.                                                                                  |
| S3-compatible object storage        | Production private documents                                 | Mentioned in `infrastructure/deployment/README.md`; not configured                         | Yes for production verification documents | Low to Medium                 | Add later with private buckets, retention, encryption, and egress controls.                       |
| Deterministic local maps adapter    | Route estimate and duration                                  | Active; CPU-only, no network                                                               | Yes if product accepts estimated distance | None                          | Keep for MVP; clearly label/approve estimate policy.                                              |
| Commercial routing/geocoding vendor | Road route/geocoding                                         | Port only; no adapter or key                                                               | No for requested MVP                      | Medium to High                | Do not add unless operational accuracy proves necessary.                                          |
| Mock OTP                            | Development authentication                                   | Active outside production; local code `123456`                                             | Development only                          | None                          | Keep strictly non-production.                                                                     |
| SMS/OTP provider                    | Production authentication                                    | No provider configured; production adapter throws                                          | Yes before production sign-in             | Medium to High                | Select later with per-message budgets, rate limits, and fraud controls.                           |
| Expo Go/Metro                       | Courier development runtime                                  | Development only                                                                           | No for production                         | None                          | Keep for development; production build/distribution decision is separate.                         |
| Payment gateway/payout provider     | In-app payments/transfers                                    | Interface only; no adapter/key/call                                                        | No                                        | None currently; High if added | Do not add for MVP.                                                                               |
| Push notification provider          | Notifications                                                | Interface only; no adapter/key/call                                                        | Optional                                  | Low to Medium                 | Defer; first MVP may use in-app refresh plus operational channels.                                |
| Phone masking provider              | Masked calls                                                 | Interface only; no adapter/key/call                                                        | No                                        | Medium                        | Defer.                                                                                            |

## 9. MVP Requirements Comparison

| Requirement                           | Current Status          | Implemented Location  | Evidence                                                | Gap                                                             | Recommended Action                                                    | Priority     |
| ------------------------------------- | ----------------------- | --------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| No live courier tracking              | `IMPLEMENTED`           | Courier app/API       | No location dependency, permission, endpoint, or writer | Dormant tracking schema may confuse scope                       | Keep API/UI absent                                                    | P0 guardrail |
| No background GPS                     | `IMPLEMENTED`           | Courier app/worker    | No Expo location task; worker has no processor          | None in runtime                                                 | Keep absent                                                           | P0 guardrail |
| No tracking WebSocket/SSE             | `IMPLEMENTED`           | Whole repo            | No gateway/subscription code                            | None                                                            | Keep absent                                                           | P0 guardrail |
| Store/drop-off coordinates            | `IMPLEMENTED`           | Merchant/API/database | Manual/saved coordinates and PostGIS points             | Manual UX                                                       | Improve input without live courier tracking                           | P2           |
| External navigation buttons           | `NOT_IMPLEMENTED`       | Courier app           | No `Linking` usage                                      | Courier cannot launch pickup/drop-off navigation                | Add allowlisted navigation URLs after acceptance                      | P1           |
| Merchant creates order                | `IMPLEMENTED`           | Merchant/API          | Quote then `POST /orders`                               | None for early flow                                             | Keep                                                                  | P0           |
| No merchant-selected courier          | `IMPLEMENTED`           | Validation/API/UI     | Order body contains only `quoteId`                      | None                                                            | Keep                                                                  | P0           |
| Available-order marketplace           | `NOT_IMPLEMENTED`       | Courier/API           | No route/screen                                         | Core MVP journey absent                                         | Add eligible list and safe summary                                    | P0           |
| Zone/city courier eligibility         | `NOT_IMPLEMENTED`       | Dispatch domain       | No query/model policy                                   | Any future list would lack eligibility policy                   | Decide and implement service-area eligibility                         | P0           |
| Atomic first-courier acceptance       | `NOT_IMPLEMENTED`       | Dispatch/order domain | No command; assignment forbidden by DB check            | Core concurrency blocker                                        | Conditional update in serializable transaction plus event/idempotency | P0           |
| One accepted offer constraint         | `PARTIALLY_IMPLEMENTED` | Migration/schema      | Partial unique `DispatchOffer_one_accepted_per_order`   | No handler and may be unnecessary for self-serve marketplace    | Use order CAS directly or formally adopt offers                       | P1           |
| Order transition history              | `PARTIALLY_IMPLEMENTED` | `OrderEvent`          | Current early transitions are append-only               | Acceptance/fulfillment event types absent                       | Extend enum and transactional event writes                            | P0           |
| Courier cancellation after acceptance | `NOT_IMPLEMENTED`       | Order domain          | Only pre-assignment cancellation exists                 | Policy and reassignment absent                                  | Product decision then command/event                                   | P1           |
| Return-order behavior                 | `NOT_IMPLEMENTED`       | Order/pricing/finance | Future statuses/field only                              | No policy, API, event, fee, or accounting                       | Decide before financial finalization                                  | P0           |
| Backend distance pricing              | `IMPLEMENTED`           | Maps/order service    | Deterministic local route + rule                        | Not road-accurate                                               | Accept estimate policy or replace later                               | P1           |
| Versioned pricing                     | `IMPLEMENTED`           | Schema/admin/API      | Immutable rule families/versions                        | UI version editing limited                                      | Add proper version editor                                             | P2           |
| Immutable price snapshot              | `IMPLEMENTED`           | Quote/order/migration | Typed amounts, JSON snapshots, triggers                 | Exact rate lacks typed order column                             | Add rate field                                                        | P0 finance   |
| Default platform commission 20%       | `NOT_IMPLEMENTED`       | Seed/pricing          | Current default is 15%                                  | Required default missing                                        | Add platform setting seeded 2000 bp                                   | P0 finance   |
| Admin-editable global commission      | `NEEDS_REDESIGN`        | Admin pricing         | Commission is embedded per pricing rule                 | No global setting/authorization history                         | Add versioned platform financial settings                             | P0 finance   |
| Exact commission rate snapshot        | `PARTIALLY_IMPLEMENTED` | Rule/breakdown/order  | Indirect via rule/version and JSON                      | No typed immutable basis-point field                            | Add typed `platformCommissionBasisPoints`                             | P0 finance   |
| Exact commission amount/net snapshot  | `IMPLEMENTED`           | Quote/order           | Integer minor fields and DB checks                      | Still an estimate, not liability                                | Preserve; recognize at final state                                    | P0 finance   |
| No in-app payment processing          | `IMPLEMENTED`           | Composition/config    | No provider binding, keys, routes, or UI                | None                                                            | Keep providers absent                                                 | P0 guardrail |
| Courier ledger                        | `PARTIALLY_IMPLEMENTED` | Database only         | Dormant immutable `LedgerEntry` table                   | No commands, ownership-safe reads, or entries                   | Redesign dormant model and implement append-only accounting           | P0 finance   |
| Settlement periods                    | `PARTIALLY_IMPLEMENTED` | Database only         | Generic dormant `Settlement` table                      | No lines/due/grace/status logic                                 | Replace/extend with coherent period model                             | P0 finance   |
| Manual external-payment record        | `NOT_IMPLEMENTED`       | None                  | No model/API/UI                                         | Cannot record payment                                           | Add append-only record/allocation/audit                               | P0 finance   |
| Partial payment/waiver/adjustment     | `NOT_IMPLEMENTED`       | None                  | Enum placeholder only for adjustment                    | No policy or command                                            | Decide permissions and implement ledger entries                       | P1 finance   |
| Courier account summary               | `NOT_IMPLEMENTED`       | Courier app/API       | Verification only                                       | All statistics/account values absent                            | Add read model and screens                                            | P1 finance   |
| Admin settlement dashboard            | `NOT_IMPLEMENTED`       | Admin app/API         | No settlement use                                       | Cannot operate accounting cycle                                 | Add after ledger/periods                                              | P1 finance   |
| Financial audit log                   | `PARTIALLY_IMPLEMENTED` | Audit infrastructure  | Immutable audit writer exists                           | No financial actions exist; ledger lacks actor/reversal linkage | Reuse audit in every command                                          | P0 finance   |
| Timezone-safe settlement deadlines    | `NOT_IMPLEMENTED`       | Config/domain         | Timestamptz exists, no operations timezone              | No Cairo cycle/deadline rules                                   | Persist timezone and use explicit Cairo calendar boundaries           | P0 finance   |

## 10. Recommended MVP Architecture

Keep the modular monolith. It already provides the correct transaction boundary for first-acceptance and money.

### 10.1 Location and navigation

- Continue storing merchant-entered pickup/drop-off coordinates and PostGIS service zones.
- Do not collect courier location.
- Define courier eligibility by explicit operating city/zone membership, not proximity.
- Return safe address summaries in the available list; expose full recipient contact/address only after successful acceptance.
- Add external-navigation buttons using allowlisted HTTPS/URI links generated from stored coordinates. Do not add a maps SDK, embedded tracking map, or background task.
- Keep `DeterministicLocalMapsProvider` for the first MVP only if product/operations approve estimate-based fares.

### 10.2 Marketplace and atomic acceptance

Prefer direct self-service acceptance over broadcast `DispatchOffer` complexity:

1. list `SEARCHING_COURIER` orders in a courier’s permitted service area;
2. in a serializable transaction, lock or conditionally update:
   - `WHERE id = ? AND status = 'SEARCHING_COURIER' AND courierId IS NULL`;
3. require approved, active, non-suspended courier with active motorcycle;
4. update `courierId`, status, and version once;
5. append `COURIER_ACCEPTED`/`COURIER_ASSIGNED` event;
6. write audit and durable idempotency;
7. return 409 to the loser.

The conditional `DeliveryOrder` update is the ownership authority. `DispatchOffer` can remain unused for MVP or be redesigned later for targeted offers; do not maintain two competing assignment authorities.

### 10.3 Commission settings and snapshot

Add one versioned platform financial setting with:

- default commission basis points = `2000`;
- settlement cycle type;
- grace-period days;
- operations timezone = `Africa/Cairo`;
- optimistic version;
- effective time and audit actor.

At quote/order creation, copy a typed `platformCommissionBasisPoints` and calculate exact minor-unit:

- delivery total;
- platform commission;
- courier net.

Keep the existing immutable amount snapshots. Do not recalculate historical orders.

### 10.4 Ledger and financial finalization

Do not expose “wallet” transfer semantics. Treat accounting as append-only receivables:

- one courier account identity;
- `CourierLedgerEntry` (or a redesigned existing `LedgerEntry`) with signed `amountMinor`, currency, order, entry type, source idempotency key, actor/system source, reversal link, and timestamps;
- unique commission source per order;
- liability created once at `COMPLETED` (recommended) or `DELIVERED` if that is the selected final policy;
- corrections through reversal/adjustment entries, never update/delete;
- balance derived from entries, not trusted mutable aggregate.

### 10.5 Settlement periods and external payments

- `SettlementPeriod`: courier, start/end, due date, status, totals, version, close/finalize times.
- `SettlementLine`: unique assignment of ledger liability entries to a settlement.
- `ExternalPaymentRecord`: immutable amount, paid date, informational method, external reference, note, actor, idempotency key, reversal relation.
- `PaymentAllocation`: explicit allocation to one or more settlements if cross-settlement allocation is allowed.
- Adjustment/waiver: append-only financial entry with reason and authorized actor.
- Worker: idempotently close due periods and update overdue projection; all commands must also be safely callable manually.

### 10.6 Read models

- Courier account summary aggregates orders, ledger, periods, payments, remaining due, deadline, and days remaining.
- Admin list aggregates courier counts and financial status without exposing generic wallet mutation.
- Exports are generated from immutable statement lines and include generation actor/time.

## 11. Files That Would Need Changes

The following are expected later changes; none were changed by this audit.

| Path                                                                 | Current responsibility            | Expected future change                                                                                                                             | Priority | Action                                 |
| -------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------- |
| `infrastructure/database/prisma/schema.prisma`                       | Canonical domain schema           | Remove Phase 2 assignment restriction; add typed commission rate, platform settings, courier account/settlement/payment structures and constraints | P0       | Modify/redesign dormant finance models |
| `infrastructure/database/prisma/migrations/<new>/migration.sql`      | Database evolution                | New safe migration, checks, unique acceptance/commission/payment constraints, immutable triggers                                                   | P0       | Add                                    |
| `infrastructure/database/prisma/seed.ts`                             | Deterministic demo data           | Seed 20% settings, eligible couriers, marketplace orders, ledger/settlement/payment scenarios                                                      | P1       | Modify                                 |
| `packages/contracts/src/orders.ts`                                   | Shared order statuses/flags       | Add executable courier events/contracts and possibly `COMPLETED`                                                                                   | P0       | Modify                                 |
| `packages/contracts/src/rbac.ts`                                     | Permissions                       | Add financial settings/payment/adjustment/export permissions with least privilege                                                                  | P0       | Modify                                 |
| `packages/contracts/src/index.ts`                                    | Contract exports                  | Export marketplace/finance contracts                                                                                                               | P1       | Modify                                 |
| `packages/validation/src/phase-two.ts` or new finance/dispatch files | Request validation                | Add acceptance, fulfillment, settings, settlement, payment, adjustment schemas                                                                     | P0       | Modify/add                             |
| `apps/api/src/orders/order-domain.ts`                                | State/pricing policies            | Extend executable transitions; keep snapshot calculation deterministic                                                                             | P0       | Modify                                 |
| `apps/api/src/orders/orders.service.ts`                              | Merchant quote/order/cancellation | Integrate post-acceptance visibility, finalization hook, return/cancellation policies                                                              | P0       | Modify                                 |
| `apps/api/src/orders/orders.controller.ts`                           | Merchant order API                | Preserve merchant flow and status visibility; avoid courier financial leakage                                                                      | P1       | Modify                                 |
| `apps/api/src/dispatch/dispatch.controller.ts`                       | Does not exist                    | Available list, detail, accept, current assignment                                                                                                 | P0       | Add                                    |
| `apps/api/src/dispatch/dispatch.service.ts`                          | Does not exist                    | Eligibility and atomic first-acceptance transaction                                                                                                | P0       | Add                                    |
| `apps/api/src/dispatch/dispatch.service.test.ts`                     | Does not exist                    | Race, eligibility, idempotency, privacy tests                                                                                                      | P0       | Add                                    |
| `apps/api/src/finance/finance.service.ts`                            | Does not exist                    | Snapshot finalization, ledger, settlement, payment, adjustment commands/read models                                                                | P0       | Add                                    |
| `apps/api/src/finance/courier-finance.controller.ts`                 | Does not exist                    | Courier summary/statements                                                                                                                         | P1       | Add                                    |
| `apps/api/src/finance/admin-finance.controller.ts`                   | Does not exist                    | Settings, settlements, payments, adjustments, export                                                                                               | P1       | Add                                    |
| `apps/api/src/finance/*.test.ts`                                     | Does not exist                    | Money, idempotency, concurrency, reversal, RBAC, time tests                                                                                        | P0       | Add                                    |
| `apps/api/src/admin/phase-two-admin.service.ts`                      | Orders/zones/pricing admin        | Split or extend order/courier aggregates; avoid mixing settlement commands into Phase 2 service                                                    | P1       | Modify or leave and add finance module |
| `apps/api/src/admin/phase-two-admin.controller.ts`                   | Phase 2 admin routes              | Keep price reads; move financial settings to dedicated strong-role controller                                                                      | P1       | Modify                                 |
| `apps/api/src/admin/admin.service.ts`                                | Verification/suspension           | Add active-order/overdue safeguards only after policy decisions                                                                                    | P1       | Modify                                 |
| `apps/api/src/app.module.ts`                                         | Composition root                  | Register dispatch and finance services/controllers                                                                                                 | P0       | Modify                                 |
| `apps/api/src/infrastructure/audit.ts`                               | Audit writer                      | Likely reusable; add correlation/idempotency metadata where needed                                                                                 | P1       | Leave mostly unchanged                 |
| `apps/worker/src/main.ts`                                            | Redis/BullMQ readiness only       | Register idempotent settlement closing/deadline jobs                                                                                               | P1       | Modify                                 |
| `apps/worker/src/finance/*.ts`                                       | Does not exist                    | Period close and overdue processors                                                                                                                | P1       | Add                                    |
| `apps/courier-mobile/App.tsx`                                        | Onboarding/verification           | Refactor/add available orders, active order, external navigation, history, account and deadlines                                                   | P0/P1    | Modify                                 |
| `apps/courier-mobile/app-flow.ts`                                    | Verification screen routing       | Add authenticated operational routing after approval                                                                                               | P0       | Modify                                 |
| `apps/courier-mobile/package.json`                                   | Mobile dependencies               | No location SDK; likely no new package because React Native `Linking` is built in                                                                  | P2       | Leave unless navigation helper needed  |
| `apps/merchant-web/app/merchant-app.tsx`                             | Quote/order UI                    | Show accepted/fulfillment/return statuses and courier-safe operational status, never courier finances                                              | P1       | Modify                                 |
| `apps/admin-web/app/admin-app.tsx`                                   | Operations console                | Role-aware settings, courier statements, settlements, manual payments, adjustments, filters, export                                                | P1       | Modify                                 |
| `apps/api/src/phase-two.e2e.test.ts`                                 | Early order integration           | Preserve current tests and add later-state compatibility assertions                                                                                | P1       | Modify                                 |
| `apps/api/src/phase-three.e2e.test.ts` or successor                  | Does not exist                    | Full marketplace race, lifecycle, finance, settlement, RBAC journey                                                                                | P0       | Add                                    |
| `.env.example` / `packages/config/src/env.ts`                        | Runtime config                    | Add explicit operations timezone only if not stored with settings; do not add payment/map secrets for MVP                                          | P1       | Modify minimally                       |
| `docs/architecture/*`, `docs/api/*`, `docs/product/*`                | Architecture/API/product records  | Record accepted policies and implementation evidence                                                                                               | P2       | Modify after decisions                 |

`packages/providers/src/local-maps.provider.ts` should remain unchanged for a zero-cost MVP unless product rejects estimate-based distance. `packages/providers/src/interfaces.ts` should not gain a payment implementation for this MVP.

## 12. Database Changes Needed

### 12.1 Reuse versus redesign

- Reuse `DeliveryOrder` as the immutable commercial snapshot; do not add a duplicate `OrderFinancialSnapshot` unless regulatory/reporting needs justify it.
- Add a typed `platformCommissionBasisPoints` to `PriceQuote` and `DeliveryOrder`; preserve existing commission/net amount columns.
- Add `financialFinalizedAt` and a unique financial-finalization source.
- Redesign dormant `Wallet`/`LedgerEntry` before use. A courier receivable account is clearer than an in-app wallet.
- Replace or substantially extend dormant `Settlement`; it lacks the required accounting semantics.

### 12.2 Proposed minimal concepts

#### `PlatformFinancialSettings`

- Singleton or versioned effective record.
- `defaultCommissionBasisPoints Int` with check `0..10000`, default 2000.
- `cycleType` enum: `DAILY`, `WEEKLY`, `SEMI_MONTHLY`, `MONTHLY`.
- `gracePeriodDays Int`.
- `operationsTimezone String`, default `Africa/Cairo`.
- `effectiveFrom`, `version`, `createdById`, timestamps.
- Immutable versions rather than in-place historical rewrite.

#### Delivery order additions

- `platformCommissionBasisPoints Int`.
- `financialFinalizedAt Timestamptz?`.
- Optional `completedAt`.
- Continue using `platformCommissionMinor`, `estimatedCourierEarningMinor`, and `currency`.
- Check: rate range, amount identities, and finalization/status consistency.

#### `CourierLedgerEntry`

- `id`, `courierId`, optional `orderId`, optional `settlementId`.
- Enum: `COMMISSION_DUE`, `PAYMENT`, `ADJUSTMENT_DEBIT`, `ADJUSTMENT_CREDIT`, `WAIVER`, `REVERSAL`.
- Signed `amountMinor BigInt` or constrained `Int`; currency.
- `sourceKey`/idempotency key unique.
- `reversesEntryId` unique where non-null.
- actor type/id, reason, metadata, occurred/created timestamps.
- Unique commission entry per order.
- Update/delete trigger rejection.
- Indexes on courier/time, order/type, settlement, source key.

#### `SettlementPeriod`

- `courierId`, `periodStart`, `periodEnd`, `dueAt`.
- Status enum sufficient for lifecycle: `OPEN`, `CLOSED`, `DUE`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `WAIVED`, `ADJUSTED`.
- Snapshot totals in minor units plus currency, version, close time, notes.
- Unique courier + period boundaries.
- Checks for period order, due date, nonnegative totals, paid/remaining identity.

#### `SettlementLine`

- `settlementId`, `ledgerEntryId`, optional `orderId`, snapshotted amount.
- Unique `ledgerEntryId` to prevent double settlement.
- Index settlement/order.

#### `ExternalPaymentRecord`

- `courierId`, `amountMinor`, currency, `paidAt`.
- Method enum: `CASH`, `BANK_TRANSFER`, `MOBILE_WALLET_EXTERNAL`, `OTHER`.
- external reference, note, enteredById, idempotency key, created time.
- immutable; corrections use `reversalOfId`.
- Decide whether external reference must be unique by method/courier.

#### `PaymentAllocation`

- Needed only if one payment may cover multiple settlements.
- Unique payment + settlement.
- Positive allocated amount and sum-not-overpayment enforcement in transaction.

#### Adjustments and waivers

Use ledger types rather than destructive settlement edits. Store actor, reason, approval role, and optional related settlement/order.

### 12.3 Required constraints

- Atomic acceptance conditional on `SEARCHING_COURIER` and null courier.
- One financial commission finalization per order.
- One ledger source/idempotency key per command.
- One settlement line per ledger liability.
- One reversal per original entry/payment.
- Period start < end <= due date.
- No float money.
- Explicit currency equality during allocation.
- Append-only triggers for ledger, settlement lines, payments, and audit.
- Optimistic versions on settings/settlement commands.

## 13. API Changes Needed

### 13.1 Add

Courier marketplace:

- `GET /api/v1/couriers/orders/available`
  - eligible, approved courier only;
  - paginated, zone/city-filtered;
  - safe pickup/drop-off summary, distance, total/earning estimate;
  - no recipient secrets before acceptance.
- `GET /api/v1/couriers/orders/available/:orderId`
- `POST /api/v1/couriers/orders/:orderId/accept`
  - idempotency key;
  - atomic first-winner semantics;
  - returns 409 when already taken.
- `GET /api/v1/couriers/orders/current`
- `GET /api/v1/couriers/orders/history`
- Lifecycle commands for arriving/pickup/in-transit/drop-off/delivery, each versioned, idempotent, and event-producing.
- `POST /api/v1/couriers/orders/:orderId/cancel` only after cancellation policy is decided.

Courier accounting:

- `GET /api/v1/couriers/account/summary`
- `GET /api/v1/couriers/settlements`
- `GET /api/v1/couriers/settlements/:settlementId`
- `GET /api/v1/couriers/account/entries`

Admin finance:

- `GET/PATCH /api/v1/admin/financial-settings` using versioned settings.
- `GET /api/v1/admin/courier-accounts` with status/date/city filters.
- `GET /api/v1/admin/couriers/:courierId/account`.
- `GET /api/v1/admin/settlements` and detail/lines.
- `POST /api/v1/admin/settlements/:id/close` if manual close is supported.
- `POST /api/v1/admin/couriers/:courierId/external-payments`.
- `POST /api/v1/admin/external-payments/:id/reverse`.
- `POST /api/v1/admin/settlements/:id/adjustments`.
- `POST /api/v1/admin/settlements/:id/waivers`.
- `GET /api/v1/admin/settlements/:id/export.csv`.

### 13.2 Modify

- Extend merchant/admin order reads to later statuses and full event history.
- Add typed commission rate to quote/order responses.
- Remove the Phase 2 status filter restriction after lifecycle implementation.
- Ensure merchant responses never contain courier accounting.
- Ensure available-order responses mask exact recipient phone/address until acceptance.
- Add active-order safety to courier suspension/reactivation.

### 13.3 Deprecated or removed from MVP scope

- No tracking-point ingestion endpoint.
- No live-location subscription endpoint.
- No payment authorization/capture/payout/withdrawal endpoints.
- No generic wallet-balance mutation endpoint.
- No `DispatchOffer` endpoints unless targeted offers become a separate future product.

### 13.4 Strong authorization

- Global financial settings: recommended `super_admin` only unless product assigns a dedicated finance-setting permission.
- External payment entry: `finance_admin` and `super_admin`; operations should not receive it implicitly.
- Waiver/adjustment: separate elevated permission, with optional dual approval for high values.
- Courier statements: owning courier or authorized finance/super admin only.
- Support role: operational order read, not unmasked financial settings/payment mutation.

## 14. UI Changes Needed

### 14.1 Courier application

After verification approval, replace the current “offers not active” notice with:

- available-order list;
- order card with pickup area/store, drop-off area, route estimate, package summary, delivery fee/net estimate;
- atomic accept action and clear “already accepted” response;
- accepted-order details with full authorized addresses/contact;
- “navigate to pickup” and “navigate to delivery” external buttons;
- lifecycle actions and version-conflict refresh;
- order history and completed/cancelled/returned counts;
- account summary: completed fees, return value, commission due, paid, remaining;
- current settlement dates, payment deadline, Cairo-based days remaining, and payment status;
- statement list/details.

Do not add location permission, background service, availability-by-GPS, or embedded live map.

### 14.2 Merchant application

Keep:

- customer/store/pickup/drop-off/package entry;
- quote review;
- immutable price;
- no courier selector.

Add:

- accepted/arriving/picked-up/in-transit/delivered/failed/return statuses;
- courier operational identity/contact only after assignment, if policy permits;
- cancellation rules and return visibility;
- clearer coordinate/address UX.

Do not expose courier commission, balance, settlement, or payment data.

### 14.3 Admin dashboard

Add role-aware navigation and controls for:

- global commission settings and version history;
- cycle type, grace period, operations timezone;
- courier list with order/account/settlement metrics;
- courier statement and included orders;
- manual external payment and partial allocation;
- adjustment, waiver, reversal, notes;
- audit history with actor;
- overdue/paid/status/date/city filters;
- suspension/reactivation warnings for active orders;
- CSV export generated from statement lines.

Hide controls the logged-in role cannot use; do not rely only on the backend 403.

## 15. Risks and Edge Cases

| Edge case                                    | Current behavior/risk                                        | Required control                                                             |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Two couriers accept simultaneously           | No handler; schema partial offer index alone is insufficient | Conditional order update/row lock; one event and idempotent winner           |
| Courier cancels after acceptance             | Not implemented                                              | Define reassignment, penalty, visibility, and event policy                   |
| Cancellation after pickup                    | Not implemented                                              | Usually failure/return flow, not simple cancellation                         |
| Return after delivery                        | Not implemented                                              | Decide whether delivery is financially final or return can create reversals  |
| Commission created before cancellation       | Current amount is only a snapshot, not ledger                | Never recognize liability before chosen final status                         |
| Global commission changes                    | No global setting; pricing version snapshots protect amounts | Version settings and typed order rate                                        |
| Historical orders                            | Financial amounts are immutable                              | Preserve; never backfill/recalculate except explicit migration evidence      |
| Partial payment                              | Not implemented                                              | Immutable payment plus allocation and derived remaining                      |
| Duplicate payment submission                 | No payment model                                             | Durable idempotency and optional external-reference duplicate warning        |
| Overpayment                                  | No policy                                                    | Decide reject, unallocated credit, or future allocation                      |
| Manual adjustment                            | Enum placeholder only                                        | Signed append-only entry with reason/actor/approval                          |
| Settlement closes while order status changes | No settlement job                                            | Serializable cutoff query, unique line, retry-safe close                     |
| Order/settlement status inconsistency        | No linkage                                                   | Database checks plus reconciliation report                                   |
| Suspension with active order                 | Verification suspension ignores orders                       | Block, defer, or handoff based on explicit policy                            |
| Reopen closed settlement                     | No policy                                                    | Prefer adjustment in later period; tightly restrict reopen                   |
| Cairo deadline calculation                   | Timestamptz but no timezone config                           | Explicit `Africa/Cairo` calendar computation and DST tests                   |
| Admin edits/deletes financial records        | No financial UI; generic schema could permit direct CRUD     | No update/delete endpoints; immutable triggers; reversals                    |
| Duplicate background job                     | Worker has no jobs yet                                       | Deterministic period key and idempotent transaction                          |
| Marketplace privacy                          | No marketplace yet                                           | Mask exact recipient/contact until acceptance                                |
| Stale app version/status                     | Acceptance/lifecycle absent                                  | Require order version and return 409 with reload                             |
| Ledger total versus mutable balance          | Dormant `Wallet.balance` can drift                           | Derive balance from immutable entries or transactionally verified projection |
| Fixed/percentage rounding                    | Price tests cover integer half-up                            | Add boundary and maximum-value property tests                                |
| Admin pricing overlap                        | Backend checks equal-priority overlaps                       | Add DB exclusion/transaction protection against concurrent activation        |
| Payment allocation race                      | Not implemented                                              | Lock settlement/payment and check remaining atomically                       |
| Currency mismatch                            | Current orders forced EGP                                    | Enforce same currency across account/period/payment                          |
| Return fee/commission interaction            | Completely undecided                                         | Decide before `COMPLETED` and settlement finalization                        |

## 16. Proposed Implementation Phases

### Phase A: Remove or disable unnecessary tracking complexity

- **Objective:** Lock the no-live-tracking MVP boundary.
- **Scope:** Document that tracking models are dormant; ensure no location permission/routes/jobs; define external-navigation-only approach.
- **Expected files:** architecture/product docs; possibly contracts feature policy. No schema deletion required.
- **Database impact:** None.
- **API impact:** No tracking endpoints.
- **UI impact:** No GPS prompts; later external navigation only.
- **Tests:** Static/dependency check for no location permission; authorization test proving no tracking route.
- **Dependencies:** Product approval of estimate-based distance.
- **Definition of done:** No client/background/live tracking behavior and clear future-only classification.

### Phase B: Stabilize available-order marketplace and atomic courier acceptance

- **Objective:** Let eligible couriers choose an order and guarantee one winner.
- **Scope:** Eligibility, safe available list, details, atomic accept, current order, assignment event/audit.
- **Expected files:** schema/migration, contracts, validation, new dispatch module, courier app, order-domain/e2e tests.
- **Database impact:** Relax Phase 2 status/courier check; add/confirm acceptance constraints and indexes.
- **API impact:** Courier marketplace/accept routes.
- **UI impact:** Available and accepted order screens.
- **Tests:** 10+ simultaneous accept attempts; idempotent retry; ineligible/suspended/cross-zone/privacy/RBAC cases.
- **Dependencies:** Eligible geography decision.
- **Definition of done:** Exactly one courier owns an order under race; loser gets 409; event/audit are atomic.

### Phase C: Add immutable commission snapshots

- **Objective:** Meet the 20% configurable setting and historical-snapshot requirement.
- **Scope:** Versioned platform settings, typed rate snapshot, exact amount/net calculation.
- **Expected files:** schema/migration/seed, pricing domain/service, admin settings API/UI, tests.
- **Database impact:** Settings model and typed quote/order rate fields/checks.
- **API impact:** Admin settings read/update; quote/order response additions.
- **UI impact:** Role-aware commission setting/history.
- **Tests:** 100 → 20/80 example; rounding; setting change leaves old order unchanged; concurrency/version conflict.
- **Dependencies:** Authorization and commission-base decisions.
- **Definition of done:** Default 2000 bp, audited version update, immutable typed rate/amount/net on every new order.

### Phase D: Add courier ledger and settlement periods

- **Objective:** Recognize commission once and group liabilities into periods.
- **Scope:** Financial finalization, ledger, periods, lines, close/overdue jobs.
- **Expected files:** schema/migration/seed, finance API/service, worker processors, tests.
- **Database impact:** Redesigned ledger/account, settlement period/line, unique source constraints.
- **API impact:** Courier/admin read models and close controls.
- **UI impact:** None beyond internal diagnostic views initially.
- **Tests:** Duplicate finalization/job, cancellation/return decisions, close race, totals, timezone.
- **Dependencies:** Final order status and return policy.
- **Definition of done:** Each final order creates one commission liability and each liability belongs to at most one settlement.

### Phase E: Add admin settlement and manual-payment tools

- **Objective:** Record off-app payments and corrections safely.
- **Scope:** Payment, allocation, partial payment, reversal, adjustment, waiver, audit, filters/export.
- **Expected files:** finance controllers/services/validation, admin app, migration, tests.
- **Database impact:** External payment/allocation/reversal records.
- **API impact:** Admin finance commands/queries/export.
- **UI impact:** Courier statement and settlement operations.
- **Tests:** Duplicate submit, partial/overpayment policy, RBAC, reversal, concurrent allocation.
- **Dependencies:** Partial/overpayment/waiver permissions decisions.
- **Definition of done:** No provider call; every mutation is idempotent, immutable/reversible, and audited.

### Phase F: Add courier account and deadline screens

- **Objective:** Give couriers a trustworthy self-service statement.
- **Scope:** Summary, counts, statement, deadline, days remaining, status.
- **Expected files:** courier finance controller/read model, courier app, localization/tests.
- **Database impact:** Read-only over Phase D/E records.
- **API impact:** Owning-courier summary/settlement endpoints.
- **UI impact:** Account and history screens.
- **Tests:** Ownership isolation, Cairo dates, empty/paid/partial/overdue/waived states.
- **Dependencies:** Stable settlement/payment model.
- **Definition of done:** Courier-visible totals reconcile exactly to immutable statement lines.

### Phase G: Tests, concurrency protection, auditability, and edge cases

- **Objective:** Production hardening.
- **Scope:** Full lifecycle/load/race/security/reconciliation/observability runbooks.
- **Expected files:** unit/e2e suites, database constraint tests, docs/runbooks.
- **Database impact:** Additional constraints/indexes discovered by testing.
- **API impact:** Stable error codes/correlation IDs.
- **UI impact:** Conflict/retry/empty/error accessibility states.
- **Tests:** All risks in Section 15, repeated jobs, restore/replay, high-value boundaries, RBAC matrix.
- **Dependencies:** Phases B–F.
- **Definition of done:** Reproducible full journey, zero unreconciled balances, documented recovery and evidence.

## 17. Final Product Decisions Required

The current code does not determine:

1. Is a return a new paid delivery, a fixed return surcharge, or unpaid?
2. Does a return keep, reverse, or adjust the original commission?
3. Is commission calculated on the complete delivery charge (base + surcharges + tax), or on a narrower delivery-fee basis?
4. Is the accounting cycle daily, weekly, semi-monthly, or monthly?
5. Which Cairo calendar boundary starts/ends a cycle?
6. How many grace-period days are allowed?
7. Is courier suspension automatic after the deadline?
8. What happens to an overdue courier with an active order?
9. Are partial payments allowed?
10. Are overpayments rejected, held as unallocated credit, or allocated forward?
11. Can one payment cover multiple settlements?
12. Can a courier have a custom commission percentage?
13. Can an administrator waive commission, and which role/approval threshold applies?
14. At which status is commission finalized: `DELIVERED` or a new `COMPLETED` state?
15. Who may edit global financial settings?
16. Who may record payments, adjustments, waivers, and reversals?
17. What geographic rule makes a courier eligible: preferred city, explicit service zones, or another operating-area assignment?
18. How much pickup/drop-off/customer detail is visible before acceptance?
19. What is the courier cancellation/reassignment policy before pickup?
20. What is the failure/return policy after pickup?
21. Is the deterministic `1.23 ×` straight-line route acceptable for billable MVP prices?
22. May a closed settlement be reopened, or must all corrections occur in a later period?

## 18. Readiness Scores

| Area                                       |      Score | Evidence-based explanation                                                                                                                                                                                  |
| ------------------------------------------ | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location MVP                               | **78/100** | No GPS/tracking/background/realtime cost; PostGIS zones and deterministic distance work. Missing external navigation and merchant-friendly location selection; estimated distance needs product acceptance. |
| Available Order Marketplace                | **10/100** | Orders reach `SEARCHING_COURIER`; no courier list, eligibility, details, or UI.                                                                                                                             |
| Order Acceptance Concurrency Safety        | **18/100** | Useful partial unique offer index, idempotency, row-lock, and version patterns exist, but no acceptance command and assignment is DB-forbidden.                                                             |
| Pricing                                    | **84/100** | Real versioned backend calculation, exact snapshots, constraints, admin controls, and tests. Gaps: 15% default, local route estimate, unused return/waiting/surge fields, limited edit UI.                  |
| Commission Snapshots                       | **56/100** | Commission/net amounts and rule version are immutable; exact typed rate/global 20% setting and final liability recognition are missing.                                                                     |
| Courier Accounting                         |  **6/100** | Dormant fields/tables only; no entries, totals, read model, or UI.                                                                                                                                          |
| Settlement Periods                         |  **7/100** | Generic table has period dates/amount/status, but no lines, due/grace, jobs, history semantics, or application code.                                                                                        |
| Admin Settlements                          |  **0/100** | No API, service, screen, filter, statement, or export.                                                                                                                                                      |
| Manual Payment Recording                   |  **0/100** | No model, endpoint, UI, allocation, idempotent command, or reversal.                                                                                                                                        |
| Financial Auditability                     | **30/100** | Immutable `AuditLog`/`LedgerEntry` triggers and idempotency primitives are strong foundations; no financial commands/actors/reversals/reconciliation exist.                                                 |
| Overall Location and Finance MVP Readiness | **24/100** | Location boundary and pricing are credible; marketplace acceptance and all operational accounting/settlement/payment workflows block production.                                                            |

High scores were not awarded for dormant schema, planned documentation, placeholder screens, provider interfaces, or unexecuted status enums.
