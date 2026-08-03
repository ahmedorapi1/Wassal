# Phase 4 API

All paths are under `/api/v1`. Protected routes require `Authorization: Bearer
<accessToken>`. Mutation bodies use explicit `version`; commands documented as
idempotent require `Idempotency-Key`.

## Authentication

- `POST /auth/login` — pilot phone/password login.
- `POST /auth/register` — pending courier or merchant application.
- `POST /auth/change-password` — verifies current password and revokes sessions.
- `POST /auth/admin/users/:userId/reset-password` — admin reset; returned
  temporary password is shown once and must be changed.

Production never uses `OTP_MOCK_CODE`. SMS OTP/public launch is deferred.

## Real-time and notifications

- Socket.IO path `/api/v1/realtime`, bearer token in socket auth.
- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/:notificationId/read`
- `POST /notifications/read-all`

## Orders, disputes, and returns

- `POST /orders` requires `quoteId`, `quoteVersion`, and
  `locationReviewed: true`.
- `POST /couriers/orders/:orderId/delivered` requires version and idempotency
  key; starts the dispute window without commission.
- `POST /merchant/orders/:orderId/delivery-disputes`
- `GET /merchant/orders/:orderId/delivery-dispute`
- `GET /couriers/orders/:orderId/delivery-dispute`
- `POST /couriers/orders/:orderId/delivery-dispute/response`
- `GET /admin/delivery-disputes`
- `GET /admin/delivery-disputes/:disputeId`
- `POST /admin/delivery-disputes/:disputeId/resolve`
- `POST /merchant/orders/:orderId/confirm-return` — version and idempotency.
- `POST /admin/orders/:orderId/confirm-return` — stale-only override, version,
  reason, and idempotency.

Admin dispute filters include status, merchant, courier, reason, and overdue.

## Payment proofs

- `POST /couriers/payment-proofs` — multipart field `file`, JPG/PNG ≤ 5 MiB,
  plus amount/method/date/reference/note; idempotency required.
- `GET /couriers/payment-proofs`
- `GET /couriers/payment-proofs/:proofId`
- `POST /couriers/payment-proofs/:proofId/cancel`
- `GET /admin/payment-proofs`
- `GET /admin/payment-proofs/:proofId`
- `POST /admin/payment-proofs/:proofId/approve` — idempotency and approved
  amount; reason mandatory for partial approval.
- `POST /admin/payment-proofs/:proofId/reject` — reason mandatory.
- `GET /payment-proofs/:proofId/file` — authenticated courier owner or
  finance/super admin only; never public.

Operations admins cannot approve proofs. Finance admins cannot resolve delivery
disputes.

## Administration and settings

- `GET /admin/operational-settings`
- `PATCH /admin/operational-settings` — super admin, append-only new version.
- `POST /admin/merchants/:merchantId/approve|reject|suspend|reactivate`
- Existing courier approval, zone assignment, finance, reversal, and audit
  routes remain authoritative.

## Health

- `GET /health` — compatibility health summary.
- `GET /health/live` — process liveness.
- `GET /health/ready` — PostgreSQL and Redis readiness.
