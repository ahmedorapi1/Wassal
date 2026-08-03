# Phase 3 API routes

All routes are below `/api/v1`, require a bearer session unless stated
otherwise, and return the repository-standard error envelope. Every command
listed with an idempotency key requires an `Idempotency-Key` header.

## Courier marketplace and lifecycle

| Method | Route                                          | Permission                    |
| ------ | ---------------------------------------------- | ----------------------------- |
| GET    | `/couriers/orders/available`                   | `courier_marketplace:read`    |
| GET    | `/couriers/orders/available/:orderId`          | `courier_marketplace:read`    |
| POST   | `/couriers/orders/:orderId/accept`             | `courier_order:accept`        |
| GET    | `/couriers/orders/current`                     | `courier_assigned_order:read` |
| GET    | `/couriers/orders/history`                     | `courier_assigned_order:read` |
| POST   | `/couriers/orders/:orderId/arriving-pickup`    | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/arrived-pickup`     | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/picked-up`          | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/in-transit`         | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/arrived-dropoff`    | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/delivered`          | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/delivery-failed`    | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/returning-to-store` | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/returned`           | `courier_lifecycle:update`    |
| POST   | `/couriers/orders/:orderId/cancel`             | `courier_lifecycle:update`    |

Accept/lifecycle bodies are `{ "version": 1 }`. Pre-pickup cancellation adds a
3–500 character `reason`. A safe available-order response never contains
customer identity, phone, exact address, instructions, or raw address
snapshots.

Example acceptance:

```http
POST /api/v1/couriers/orders/ORDER_ID/accept
Authorization: Bearer …
Idempotency-Key: accept-550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{"version":1}
```

Exactly one racing courier receives 201. Couriers that lose the row/version
race receive 409.

## Courier statements

| Method | Route                                 | Permission                |
| ------ | ------------------------------------- | ------------------------- |
| GET    | `/couriers/account/summary`           | `courier_account:read`    |
| GET    | `/couriers/account/entries`           | `courier_account:read`    |
| GET    | `/couriers/settlements`               | `courier_settlement:read` |
| GET    | `/couriers/settlements/:settlementId` | `courier_settlement:read` |

These endpoints are self-scoped from the authenticated user. A courier cannot
supply a different courier ID.

## Administration and finance

| Method | Route                                          | Permission                  |
| ------ | ---------------------------------------------- | --------------------------- |
| GET    | `/admin/financial-settings`                    | `finance_settings:read`     |
| PATCH  | `/admin/financial-settings`                    | `finance_settings:update`   |
| GET    | `/admin/courier-accounts`                      | `courier_accounts:read`     |
| GET    | `/admin/couriers/:courierId/account`           | `courier_accounts:read`     |
| GET    | `/admin/settlements`                           | `settlements:read`          |
| GET    | `/admin/settlements/:settlementId`             | `settlements:read`          |
| POST   | `/admin/settlements/:settlementId/close`       | `settlements:close`         |
| POST   | `/admin/couriers/:courierId/external-payments` | `external_payments:create`  |
| POST   | `/admin/external-payments/:paymentId/reverse`  | `external_payments:reverse` |
| POST   | `/admin/couriers/:courierId/adjustments`       | `adjustments:create`        |
| GET    | `/admin/settlements/:settlementId/export.csv`  | `financial_exports:create`  |

Example external payment (a record of money already received elsewhere):

```json
{
  "amountMinor": 1250,
  "currency": "EGP",
  "paidAt": "2026-07-26T18:30:00.000Z",
  "method": "BANK_TRANSFER",
  "externalReference": "BANK-REFERENCE-123",
  "note": "Confirmed outside WASSAL"
}
```

The operation never contacts a bank, wallet, gateway, or payout provider.
