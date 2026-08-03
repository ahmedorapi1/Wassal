# Phase 4 operations architecture

## Scope and invariants

Phase 4 keeps WASSAL as a modular monolith. PostgreSQL is authoritative; Socket.IO
only carries small operational invalidation events. There is no customer account,
customer OTP, electronic proof of delivery, live tracking, courier GPS stream,
background location, dispatch engine, SMS/WhatsApp notification, payment gateway,
or paid maps API.

Money remains integer EGP minor units. Ledger, settlement, order-event, dispute,
proof-review, and audit history is append-only. A courier pressing “delivered”
does not complete an order and does not create commission.

## Address and location policy

Addresses retain the original free-form line and PostGIS point while adding
governorate, city, area, street, building, floor, apartment, landmark, delivery
notes, and an optional source Maps URL. Supported HTTPS Google Maps URLs are
parsed locally for coordinates. Short links or URLs without explicit
coordinates are rejected rather than followed. Manual latitude/longitude entry
remains available.

A quote is not an order. Confirmation requires `quoteId`, the quote `version`,
and `locationReviewed: true`. The merchant UI shows customer, pickup, drop-off,
coordinates, source link, approximate offline distance/duration, price, and a
warning before the final confirmation.

## Real-time protocol

Socket.IO is mounted at `/api/v1/realtime`. Authentication uses the same bearer
access token and active session as REST. Rooms are derived server-side:

- `user:<userId>`
- `merchant:<merchantId>` from active memberships
- `courier:<courierId>` from the authenticated courier profile
- `service-zone:<zoneId>` from active courier-zone assignments
- `admin:<role>` for internal roles

Clients cannot request arbitrary rooms. No `tracking`, `location`, latitude, or
longitude event exists. Every event has an opaque UUID `id`, a stable `type`,
`version: 1`, `occurredAt`, and a privacy-minimized payload. Supported event
families are `marketplace.order.available`, `marketplace.order.removed`,
`order.updated`, `notification.created`, and `payment-proof.updated`.

Clients deduplicate event IDs, fetch authoritative REST state on
`realtime.ready`, and reconcile every 30 seconds. Disconnects therefore degrade
to delayed updates, not inconsistent state.

## Persisted notifications

Notifications belong to one user, have a type, Arabic-first title/body,
optional related entity and deep link, read timestamp, expiry timestamp, and a
recipient-scoped deduplication key. APIs support list, unread count, mark one
read, and mark all read. A worker removes expired **read** notifications only;
audit and domain history are never removed by that job.

No Phase 4 notification invokes SMS, WhatsApp, email, or push.

## Delivery, disputes, and finalization

`AT_DROPOFF -> DELIVERED` snapshots `deliveredAt` and the deadline computed from
the then-current versioned operational setting (default 24 hours). The state is
visible to the merchant and courier and commission remains absent.

During the deadline, a merchant owner or manager may create one dispute.
The order becomes `DELIVERY_DISPUTED`; the assigned courier may respond once.
Operations can resolve:

- confirm delivery: complete once and create one commission;
- confirm not delivered: fail without commission;
- require return: enter the return flow without commission.

The worker row-locks overdue delivered orders, rechecks the deadline and absence
of an open dispute, and calls the same idempotent finalization policy. The
financial source key `order:<id>:commission`, unique order/ledger constraints,
and `financialFinalizedAt` make duplicate execution safe.

## Failed delivery and return

Failure requires a structured reason and optional note. The courier explicitly
starts return and reports arrival at the store. Arrival moves the order to
`RETURN_AWAITING_MERCHANT_CONFIRMATION`; it is not yet final.

The merchant owner/manager confirms condition and note using version and
idempotency controls. An operations override requires the snapshotted timeout
to be stale and an explicit reason. Either accepted confirmation creates typed
events, notifications, audit history, and calls finalization once. There is no
separate return charge.

## External payment proofs

Courier receipt screenshots are JPG/PNG only, maximum 5 MiB, and are checked by
declared MIME plus magic bytes. Names are normalized, bytes are checksummed,
references are normalized, and possible duplicates are warning indicators—not
proof of fraud.

Submission creates `PENDING_CONFIRMATION` and never changes the balance.
Finance or super admin may fully/partially approve (partial requires a reason)
or reject. Proof approval and the existing oldest-first external-payment
accounting command share one serializable transaction. Thus a committed
approval always has exactly one payment/ledger effect, while rollback changes
neither. Rejection creates no financial entry.

Files are never publicly addressed. Courier ownership or finance permission is
checked before the API streams bytes with private/no-store and nosniff headers.
Local storage is development-only; production configuration requires encrypted
private S3-compatible storage.

## Pilot authentication

Controlled pilot accounts use Egyptian phone plus a salted scrypt password.
Courier and merchant self-registration creates a `PENDING` account. Pending
couriers may complete their profile, motorcycle, documents, and review
submission but operational eligibility still requires an active, approved
courier. Admin approval activates the account. Merchant approval is a separate
audited operation.

Login uses generic failures, IP/phone Redis rate limits, five-attempt temporary
account locking, rotating/revocable sessions, admin temporary-password reset,
and forced change. Existing development OTP endpoints are retained for earlier
phase compatibility, but the mock provider cannot run in production and Phase
4 does not add an SMS provider.

Public unrestricted registration remains deferred until real SMS OTP,
anti-abuse, consent evidence, phone-change, recovery, provider failover, and
delivery monitoring are implemented.
