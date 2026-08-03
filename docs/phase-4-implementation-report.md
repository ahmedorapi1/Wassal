# WASSAL Phase 4 implementation report

Date: 2026-07-27  
Migration: `20260727120000_phase_4_realtime_disputes_proofs`

## 1. Executive summary

Phase 4 is implemented across the NestJS modular monolith, BullMQ worker,
merchant/admin Next.js applications, Expo courier application, Prisma/PostGIS
database, provider layer, deterministic seed, tests, and operations
documentation.

WASSAL now supports reviewed structured locations, authenticated app-open
real-time updates with REST reconciliation, persisted in-app notifications, a
24-hour delivery-dispute window, delayed commission finalization, confirmed
returns, private external-payment proof review, controlled pilot
phone/password access, public legal drafts, and executable production
configuration/storage foundations.

No Phase 5 or later capability was implemented.

## Post-Phase-4 operational policy update — 2026-08-02

SKKA now enforces a persisted five-minute courier-acceptance window with one
merchant-controlled retry and a worker-owned final timeout. Merchant
owner/manager cancellation is free through `AT_PICKUP`; from `PICKED_UP`, it
uses the existing confirmed-return lifecycle, preserves the full original
delivery fee, and adds no return fee. See
[`order-cancellation-and-acceptance-timeout-report.md`](order-cancellation-and-acceptance-timeout-report.md)
for the state, concurrency, UI, migration, and verification details.

## 2. Product decisions implemented

- PostgreSQL/REST remains authoritative; realtime transports invalidations.
- Customers still have no account and no OTP.
- Delivery evidence remains optional paper evidence outside the application.
- `DELIVERED` is non-financial until the deadline or an admin resolution.
- Return arrival requires merchant confirmation or a stale admin override.
- Proof upload does not reduce courier liability until finance approval.
- Pilot phone/password registration is pending and administrator-controlled.
- Notifications are in-app only.
- Maps coordinates are parsed locally and route estimates remain offline.

## 3. Address and location UX

Addresses preserve their free-form line and PostGIS point while adding street,
delivery notes, and source Maps URL to the already structured
governorate/city/area/building/floor/apartment/landmark fields. Shared
validation accepts supported HTTPS Google Maps URLs only when explicit Egyptian
coordinates can be extracted; unsupported short/redirect links are rejected.
Manual coordinates remain available.

## 4. Location review workflow

The merchant quote result now presents customer, pickup/drop-off text,
coordinates, optional source link, approximate distance/duration, price, and a
review warning. Order creation requires the exact quote ID/version and
`locationReviewed: true`; an older quote version or unchecked review cannot
create an order.

## 5. Real-time architecture

Socket.IO is attached to the API HTTP server at `/api/v1/realtime`.
JWT/session authentication precedes connection. The server derives user,
merchant, courier, service-zone, and admin rooms from database ownership; the
client cannot subscribe to arbitrary rooms.

Event envelopes contain UUID ID, stable type, protocol version, occurrence
time, and minimized payload. Marketplace availability/removal, order changes,
notifications, and proof-review updates are supported. Clients deduplicate IDs,
reconcile on connection, and poll REST every 30 seconds. No tracking/location
room or event exists.

## 6. Notification architecture

`Notification` persists recipient, type, Arabic-first content, related entity,
deep link, read time, expiry, metadata, and a unique deduplication key.
Recipient-scoped APIs list/read/count notifications. All three applications
show notification centers and mark items read; merchant order links reconcile
to authoritative details. The worker cleans expired read notifications only.

## 7. Delivery completion and dispute workflow

Courier delivery records `deliveredAt`, note, and a deadline snapshotted from
the current operational-settings version. It creates events/notifications but
no commission.

Owner/manager may create one in-window dispute. The assigned courier may
respond once. Operations can confirm delivery, confirm non-delivery, or require
return. The worker row-locks overdue undisputed deliveries and rechecks every
condition. API and worker completion paths use one-commission uniqueness,
financial-finalization state, events, audit, settlement projection, and
notifications. Concurrent duplicate worker execution waits/rechecks and exits
without an error or second commission.

## 8. Return confirmation workflow

Failed delivery uses a structured reason. Courier return arrival enters
`RETURN_AWAITING_MERCHANT_CONFIRMATION`. Owner/manager confirmation requires
version and idempotency. Admin override additionally requires the versioned
timeout to have elapsed and an explicit reason. Accepted confirmation produces
typed evidence and calls finalization once; no separate return charge exists.

## 9. Payment-proof workflow

Courier submits a JPG/PNG receipt (maximum 5 MiB), amount, method, paid time,
optional external reference, and note. MIME and file signatures are checked,
names/reference are normalized, bytes are SHA-256 checksummed, and duplicate
signals remain warning-only.

Finance/super admin can fully approve, reasoned-partially approve, or reject.
The proof update and the reused oldest-first external-payment accounting
command execute in one serializable transaction. Approval links exactly one
payment; rejection changes no ledger balance. Review history is append-only.
Operations cannot approve. Couriers can inspect only their own proof/file.

## 10. Authentication changes

Pilot login uses normalized Egyptian phone plus salted Node scrypt passwords.
Redis applies phone/IP limits; five repeated failures create a temporary
account lock and audit event. Sessions remain rotating and revocable.

Courier/merchant registration creates `PENDING`. Pending couriers can complete
verification data but cannot become operationally eligible. Courier or merchant
approval activates the account. Admin reset returns a generated temporary
password once, revokes sessions, and forces change.

Development OTP endpoints remain for prior-phase compatibility. The mock
provider cannot operate under production configuration. No SMS provider was
added.

## 11. Privacy and terms pages

Arabic-first `/privacy` and `/terms` pages with English summaries are built by
merchant web. They cover Phase 4 data, delivery/dispute/payment rules,
retention/security, prohibited behavior, placeholders, and deferred
requirements. Both are explicitly drafts requiring qualified Egyptian legal
review.

## 12. Database migration

One additive migration,
`20260727120000_phase_4_realtime_disputes_proofs`, adds:

- password/lock fields;
- structured address additions;
- operational-setting versions;
- delivered/dispute/finalization/failure/return order fields and states;
- delivery disputes;
- persisted notifications;
- courier payment proofs and append-only reviews;
- ownership, status, deadline, and uniqueness indexes/constraints;
- private-proof/append-only guards;
- an expanded order snapshot trigger that permits only Phase 4 lifecycle
  evidence fields while preserving immutable customer/address/package/route/
  pricing/commission snapshots.

Both a Phase 3 upgrade and a clean Phase 0–4 deployment succeeded. Existing
records were preserved.

## 13. New and modified files

Principal new files:

- `infrastructure/database/prisma/migrations/20260727120000_phase_4_realtime_disputes_proofs/migration.sql`
- `packages/validation/src/phase-four.ts` and tests
- `packages/providers/src/s3-object-storage.provider.ts`
- `packages/config/src/env.test.ts`
- `apps/api/src/auth/password.ts` and tests
- `apps/api/src/realtime/*`
- `apps/api/src/notifications/*`
- `apps/api/src/operations/*`
- `apps/api/src/orders/order-finalization.service.ts`
- `apps/api/src/payment-proofs/*`
- `apps/api/src/readiness.controller.ts`
- `apps/api/src/phase-four.e2e.test.ts`
- `apps/worker/src/phase-four-jobs.ts` and tests
- `apps/admin-web/app/phase-four-operations.tsx`
- `apps/courier-mobile/eas.json`
- `apps/merchant-web/app/privacy/page.tsx`
- `apps/merchant-web/app/terms/page.tsx`
- Phase 4 architecture/API/policy/runbook documents and this report.

Principal modified files include Prisma schema/seed, environment example,
provider/contracts/RBAC exports, API module/main/auth/admin/order/customer/
courier services and controllers, worker scheduling, all three application
surfaces and package manifests, root lockfile, README, tests, and RBAC docs.

The repository already contained uncommitted Phase 1–3 work; it was preserved.
No commit was created.

## 14. New APIs

The authoritative list is `docs/api/phase-4-routes.md`. It includes pilot
login/register/password/reset, notification read/list/count, merchant/courier/
admin dispute routes, merchant/admin return confirmation, courier/admin proof
routes and secure file stream, operational settings, merchant approval, and
health live/ready endpoints.

## 15. UI changes

- Merchant: password login, structured address/Maps input, final quote/location
  review, dispute deadline/actions, return confirmation, realtime state, and
  notification center.
- Courier: password pilot flow, realtime marketplace/order reconciliation,
  dispute response, structured failure/return states, proof upload/history/
  authenticated preview, notifications, and legal links.
- Admin: password login, dispute queue/detail/resolution, proof review/private
  preview, operational setting versions, merchant approval controls,
  notification center, and realtime health indicator.

## 16. RBAC changes

New permissions cover dispute read/resolve, stale return override, proof
create/read/cancel/review/approve/reject/private file, and operational settings
read/update. Operations resolves disputes and return overrides; finance reviews
proofs; only super admin versions settings. Merchant owner/manager—but not
staff—can dispute/confirm return. Courier resources remain ownership-scoped.

## 17. Worker jobs

- overdue delivered-order finalization;
- dispute/return/payment-proof reminders;
- existing settlement reminders/reconciliation;
- expired read-notification retention.

Every financial completion is row-locked, independently idempotent, and safe to
run again.

## 18. Security controls

- bearer JWT plus active/pending allowed-session verification;
- server-derived socket rooms and minimized event payloads;
- tenant/resource ownership checks;
- password hashing, generic failures, rate limits, lockout, session revocation;
- magic-byte/MIME/size/name/checksum proof validation;
- private/no-store/nosniff file responses;
- development-only local storage and production-required private encrypted S3;
- production CORS allowlist validation and wildcard rejection;
- trusted-proxy switch, Helmet, readiness checks, audit, and immutable financial
  history;
- Android foreground/background location permissions explicitly blocked.

## 19. Production-readiness changes

`APP_ENV` supports development/test/staging/production. Production validation
requires `NODE_ENV=production`, S3 storage configuration, and explicit CORS.
The S3 adapter uses private keys/prefixes, AES-256 server-side encryption,
direct private reads/writes/deletes, and signed uploads. `/health/live` and
`/health/ready` support orchestration.

The deployment/backup/restore/incident/reconciliation/admin runbook and EAS
internal APK/AAB profiles are included. No domain, paid service, production
secret, or signing key was configured.

## 20. Test coverage

Coverage includes address/Maps parsing, location review, dispute deadlines and
eligibility, proof amount/duplicate logic, notification deduplication,
passwords, production config, socket room isolation, authenticated/anonymous
socket integration, delivery dispute/resolution, return idempotency, proof
transaction/roles/private-file ownership, duplicate worker execution,
PostgreSQL constraints, all prior E2E journeys, and Android upload utilities.

Final result: **35 test files, 139 tests passed, 0 failed**.

## 21. Verification commands and exact results

- `pnpm.cmd format:check` — passed; all files match Prettier.
- `pnpm.cmd lint` — passed; zero warnings/errors.
- `pnpm.cmd typecheck` — 13/13 workspaces passed.
- `pnpm.cmd test` against a fresh migrated/seeded PostGIS database — 35/35
  files and 139/139 tests passed.
- `pnpm.cmd build` — API, worker, admin web, merchant web, and Android Expo
  export passed. Merchant `/privacy` and `/terms` were statically generated.
- `node node_modules\prisma\build\index.js validate` — schema valid.
- `pnpm.cmd db:deploy` from an empty database — all five migrations applied.
- `pnpm.cmd db:seed` twice — both invocations succeeded.
- `pnpm.cmd db:status` — database schema up to date.
- `docker compose ps` — PostGIS and Redis healthy; Redis returned `PONG`.
- built API smoke — `/health`, `/health/live`, and `/health/ready` returned
  HTTP 200; readiness reported database and Redis `ok`.
- forbidden-feature searches — no `expo-location`, location API,
  Google Directions, payment-gateway SDK, WhatsApp integration, or electronic
  signature dependency. Android location permissions appear only in
  `blockedPermissions`.

Non-failing test output includes a Prisma PostgreSQL-adapter deprecation warning
about overlapping `client.query()` calls for future pg 9 compatibility; all
assertions and transactions passed.

## 22. Remaining limitations

- No production domain/infrastructure credentials were supplied or deployed.
- The S3 adapter/config validation is implemented, but no real production
  bucket was connected during local verification.
- EAS build profiles are reproducible; a signed APK/AAB was not uploaded
  because no signing/project credentials were provided.
- Malware scanning and formal retention schedules require an approved
  production storage/security operator.
- Legal text requires qualified Egyptian counsel.
- Push/email/SMS/WhatsApp remain intentionally absent.

## 23. Deferred public-launch requirements

Before unrestricted registration: production SMS OTP with consent evidence,
anti-abuse, recovery/phone-change policy, delivery monitoring and failover;
qualified legal approval; domain/TLS/CSRF decisions; signed Android release and
device matrix; production backup/PITR restore drill; private storage/malware/
retention policy; operational staffing and incident exercises.

## 24. Updated total MVP implementation percentage

- Requested Phase 4 specification implementation: **100%**
- Broader pilot MVP implementation/readiness: **96%**

The remaining 4% is external public-launch validation/operations—legal approval,
production infrastructure, real SMS verification, signing/device acceptance,
and live restore/security drills—not missing Phase 4 domain behavior.

## Final scope confirmations

- Commission is delayed until the dispute deadline expires or administration
  resolves delivery; courier “delivered” never creates it immediately.
- No live tracking, GPS stream, or background location was added.
- No paid maps or Google Directions API was added.
- No SMS/OTP provider integration was added; public OTP remains deferred.
- No payment gateway, wallet, payout, or automated transfer was added.
