# Phase 4 deployment and operations runbooks

## Environment boundaries

Use distinct development, test, staging, and production databases, Redis
instances, object buckets/prefixes, signing secrets, and service credentials.
Set `APP_ENV` explicitly. Production startup validation requires:

- `NODE_ENV=production`, `APP_ENV=production`
- private `STORAGE_DRIVER=s3` with region, bucket, credentials, and a unique
  production prefix
- explicit HTTPS `CORS_ORIGINS`; `*` is rejected
- `TRUST_PROXY=true` only behind the trusted ingress
- unique high-entropy token/pepper secrets from a secret manager

Recommended hosts are `api.<domain>`, `merchant.<domain>`, and
`admin.<domain>`. Terminate HTTPS at a controlled proxy, redirect HTTP, enable
HSTS after domain validation, pass trusted forwarding headers, use secure
same-site cookies if cookie auth is later added, and protect cookie mutations
with CSRF tokens. Do not purchase/configure domains from this repository.

## Release checklist

1. Back up and record the release SHA.
2. Run format, lint, typecheck, tests, production builds, Prisma validation,
   and a clean migration rehearsal.
3. Apply `prisma migrate deploy` with a restricted migration identity.
4. Start API/worker and check `/health/live` then `/health/ready`.
5. Deploy web clients with the HTTPS API URL; verify CORS.
6. Run delivery/dispute/return/proof smoke journeys with synthetic accounts.
7. Check worker failures, reconciliation, logs, database connections, Redis,
   storage writes/reads, and object privacy.
8. Keep a rollback application artifact; database rollback is forward-fix only.

PostgreSQL must include PostGIS, connection pooling/limits, storage/connection
alarms, daily automated backups, and point-in-time recovery where available.
Use a restricted runtime identity distinct from migration/backup identities.

## Backup and restore drill

Daily backups are retained according to approved policy. Quarterly, restore the
latest backup plus WAL/PITR into an isolated non-production database, enable
PostGIS, run `prisma migrate status`, compare row counts and financial
reconciliation totals, inspect random private-object references, and document
RPO/RTO and discrepancies. Never test restore over production.

## Private storage

The bucket has no public access, encryption at rest, versioning/durability
policy, narrowly scoped `Get/Put/DeleteObject` credentials, lifecycle rules for
approved retention, and access logs. Files are served through authorized API
reads or short-lived signed upload URLs. Validate MIME and signatures, cap
size, normalize names, and schedule malware scanning before public launch.
Abandoned temporary objects may be cleaned; referenced courier documents,
proofs, audits, payments, and disputes must not be silently deleted.

## Operational workflows

- **Courier approval:** inspect profile, active motorcycle, every current
  required unexpired document; approve documents, then courier; assign zones.
- **Merchant approval:** verify pilot agreement and owner identity outside the
  app; approve the pending merchant. Rejection/suspension requires a reason.
- **Payment proof:** finance reviews private image, duplicate warnings,
  amount/date/reference, then full/partial approval or rejection. Partial and
  reject require reasons. Reverse mistakes through the existing linked reversal
  command—never edit ledger/payment rows.
- **Delivery dispute:** operations inspects order/events, merchant claim,
  courier’s one response, and optional external paper evidence; resolve
  delivery confirmed, not delivered, or return required with a clear note.
- **Return awaiting confirmation:** merchant confirms condition. Operations
  override only after configured timeout with reason.
- **Overdue settlement:** verify worker status and reconciliation, contact via
  approved off-platform pilot procedure, suspend manually when policy requires,
  and audit the decision.
- **Password reset:** admin generates a temporary password, conveys it through
  the controlled pilot channel, and verifies forced change. Never log it.
- **Data-access request:** authenticate requester, scope to their tenant/data,
  export through an approved secure channel, record approval, and redact third
  parties.
- **Incident:** contain credentials/traffic, preserve logs/audits, classify
  personal/financial exposure, notify authorized leads, rotate secrets, restore
  service, reconcile, and write a post-incident record.
- **Failed worker job:** inspect structured job error and dependency readiness,
  correct the cause, rerun the idempotent job, then reconcile order/ledger and
  notification results.
- **Financial reconciliation:** compare completed orders to unique commission
  entries, proof approvals to external payments, payment allocations to closed
  settlements, and projections to append-only lines. Fix with approved
  compensating entries/reversals.

Logs use correlation IDs and safe actor/entity IDs. Never log passwords,
tokens, secrets, full phone numbers, file bytes, or sensitive documents.

## Android pilot build

Expo Go is development-only. Replace the placeholder API URL in an uncommitted
build environment and run:

```powershell
cd apps/courier-mobile
npx eas-cli build --platform android --profile pilot
```

The `pilot` profile creates an internal APK; `production` creates an AAB.
Signing keys stay in EAS/approved secret storage and are never committed. Before
distribution, test RTL, authenticated image upload/preview, external navigation,
socket disconnect/reconnect plus REST reconciliation, and no location
permission on at least Android 10, 12, 14, and 16 across small/large screens.
