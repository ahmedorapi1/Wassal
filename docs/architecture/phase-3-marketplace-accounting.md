# Phase 3 marketplace and courier accounting

## Scope

Phase 3 completes WASSAL's first delivery loop. A merchant confirms a priced
order, an eligible courier in the order's service zone accepts it directly,
the courier advances a typed lifecycle, and completion creates an immutable
platform-commission liability. Finance administrators reconcile money that was
already paid outside WASSAL.

This phase deliberately has:

- no live tracking or background GPS;
- no courier availability switch;
- no automatic matching or dispatch offers;
- no in-app wallet;
- no payment gateway or payment-provider call;
- no automatic payout or money transfer.

Distances remain deterministic offline estimates, not road-network routes.
Courier navigation buttons open an external directions URL for a stored address.
The Expo app never requests device location.

## Marketplace eligibility and privacy

An order is visible only when it is `SEARCHING_COURIER`, unassigned, and its
active service zone is in the courier's active `CourierServiceZone`
memberships. The courier must also have:

1. an active user account;
2. `APPROVED` verification;
3. an active motorcycle;
4. all current required documents approved and unexpired.

Before acceptance, the API returns store/area, destination area, package
characteristics, estimated distance/duration, fee, and estimated courier net.
It does not return the customer's identity, phone, exact address, instructions,
or full address snapshots. Full operational data is returned only to the
assigned courier after acceptance.

## Atomic first-courier-wins acceptance

Acceptance runs in a serializable PostgreSQL transaction:

1. claim the `(scope, idempotency key)` command record;
2. lock the `DeliveryOrder` row with `SELECT … FOR UPDATE`;
3. recheck status, null assignment, version, courier eligibility, and zone
   membership;
4. conditionally update the same status/version and set `courierId`;
5. append one `COURIER_ACCEPTED` event and one audit record;
6. complete the idempotency record and commit.

The first committed update succeeds. Every different eligible courier racing
the same version receives HTTP 409 after the winner commits. `DispatchOffer`
is not queried or written and has no assignment authority.

## Order lifecycle and returns

```text
SEARCHING_COURIER
  → COURIER_ASSIGNED
  → COURIER_ARRIVING_PICKUP
  → AT_PICKUP
  → PICKED_UP
  → IN_TRANSIT
  → AT_DROPOFF
  → DELIVERED
  → COMPLETED
```

Before pickup, the assigned courier may cancel. The command clears `courierId`,
returns the order to `SEARCHING_COURIER`, increments its version, and appends a
typed cancellation event/audit record. It does not cancel the merchant order.

After pickup, normal cancellation is forbidden. A failed delivery follows:

```text
PICKED_UP or IN_TRANSIT or AT_DROPOFF
  → DELIVERY_FAILED
  → RETURNING_TO_STORE
  → RETURNED
  → COMPLETED
```

A return retains the original delivery price. It creates neither a return-trip
charge nor a second/reversed commission.

Every transition is version-checked, idempotent, restricted to the assigned
courier, and accompanied by a typed `OrderEvent` plus audit evidence.
`DELIVERED`/`RETURNED` are operational reports; `COMPLETED` is the atomic
financial-finalization state.

## Commission snapshots and integer money

`PlatformFinancialSetting` is append-only and versioned. The default setting is
2,000 basis points (20%), weekly settlements, seven grace days, and
`Africa/Cairo`.

Quote calculation resolves the effective setting and uses integer minor units:

```text
commissionMinor = round_half_up(merchantTotalMinor × basisPoints / 10,000)
courierNetMinor = merchantTotalMinor - commissionMinor
```

The quote and resulting order both store
`platformCommissionBasisPoints`, the commission amount, and the pricing
breakdown. A later setting version never changes a historical quote/order.
No JavaScript floating-point arithmetic is used for persisted money.

## Ledger convention

`CourierLedgerEntry` is append-only:

| Entry               | Sign | Meaning                               |
| ------------------- | ---: | ------------------------------------- |
| `COMMISSION_DUE`    |    + | Courier owes WASSAL                   |
| `ADJUSTMENT_DEBIT`  |    + | Increases courier liability           |
| `ADJUSTMENT_CREDIT` |    − | Decreases courier liability           |
| `WAIVER`            |    − | WASSAL waives existing liability      |
| `EXTERNAL_PAYMENT`  |    − | Payment occurred outside WASSAL       |
| `REVERSAL`          |    ± | Compensates a specifically linked row |

Completion inserts exactly one `COMMISSION_DUE` per order. Database partial
uniqueness makes that invariant final even under retries. Existing entries are
never edited or deleted; corrections use a unique linked reversal.

## Weekly settlements in Cairo

Periods are half-open Cairo calendar weeks: Monday `00:00` inclusive to the
next Monday `00:00` exclusive. Bounds are converted to UTC using IANA timezone
rules, including Egypt daylight-saving changes. `dueAt` is the period end plus
the configured grace days in Cairo calendar time.

Completion creates/fetches the courier's open period and adds one unique
`SettlementLine` for the commission entry. The worker idempotently closes ended
periods and marks unpaid, past-due periods overdue. Admin close is also
idempotent and refuses a period that has not ended.

Settlement projections are derived from immutable source lines and payment
allocations. Status may be `OPEN`, `NOT_DUE`, `DUE_SOON`, `PARTIALLY_PAID`,
`PAID`, `OVERDUE`, `WAIVED`, or `ADJUSTED`.

## External-payment workflow

Finance and super administrators may record a positive EGP payment only after
it occurred outside WASSAL. The command stores the time, method, optional
external reference/note, creator, and unique idempotency key. It allocates the
amount to the oldest closed outstanding settlements first and rejects any
overpayment. It then appends a negative ledger entry and refreshes projections.

There is no provider adapter and no outbound call. Super administrators may
reverse a payment, waive liability, or add/reverse adjustments. Originals stay
immutable.

## Recovery and reconciliation

- Retry commands with the same idempotency key and identical body.
- Treat a 409 acceptance as a normal lost race; reload available orders.
- Compare one completed order to its one commission entry and one settlement
  line.
- Rebuild settlement totals from immutable lines and allocations with
  `refreshSettlementProjection`.
- Investigate differences through `AuditLog`, typed order events, payment
  creator/reference, and ledger `sourceKey`.
- Use settlement CSV export for offline reconciliation.
- Correct erroneous entries with linked reversals; never edit database history.
- If a worker was unavailable, its repeatable close/overdue jobs safely catch
  up when it returns.
