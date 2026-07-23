# Phase 1 API routes

All routes are under `/api/v1`. Validation failures return 400, missing or
invalid authentication returns 401, denied roles/ownership return 403, missing
scoped resources return 404, and stale optimistic versions return 409.

## Authentication

| Method | Route               | Authentication          |
| ------ | ------------------- | ----------------------- |
| POST   | `/auth/request-otp` | Public, rate limited    |
| POST   | `/auth/verify-otp`  | Public, attempt limited |
| POST   | `/auth/refresh`     | Refresh token           |
| POST   | `/auth/logout`      | Access token            |
| POST   | `/auth/logout-all`  | Access token            |
| GET    | `/me`               | Access token            |

## Merchant

| Method    | Route                                    |
| --------- | ---------------------------------------- |
| POST      | `/merchants`                             |
| GET/PATCH | `/merchants/current`                     |
| POST/GET  | `/merchants/current/stores`              |
| GET/PATCH | `/merchants/current/stores/:storeId`     |
| POST/GET  | `/merchants/current/staff`               |
| PATCH     | `/merchants/current/staff/:membershipId` |

## Courier

| Method         | Route                                         |
| -------------- | --------------------------------------------- |
| POST/GET/PATCH | `/couriers/profile`                           |
| POST/GET       | `/couriers/vehicles`                          |
| PATCH          | `/couriers/vehicles/:vehicleId`               |
| POST/GET       | `/couriers/documents`                         |
| GET            | `/couriers/documents/:documentId/file`        |
| POST           | `/couriers/documents/:documentId/replacement` |
| POST           | `/couriers/submit-for-review`                 |
| GET            | `/couriers/verification-status`               |

## Administration

| Method | Route                                                                  |
| ------ | ---------------------------------------------------------------------- |
| GET    | `/admin/couriers?status=&search=`                                      |
| GET    | `/admin/couriers/:courierId`                                           |
| GET    | `/admin/couriers/:courierId/documents`                                 |
| POST   | `/admin/couriers/:courierId/documents/:documentId/approve`             |
| POST   | `/admin/couriers/:courierId/documents/:documentId/reject`              |
| POST   | `/admin/couriers/:courierId/documents/:documentId/request-replacement` |
| POST   | `/admin/couriers/:courierId/approve`                                   |
| POST   | `/admin/couriers/:courierId/reject`                                    |
| POST   | `/admin/couriers/:courierId/suspend`                                   |
| POST   | `/admin/couriers/:courierId/reactivate`                                |
| GET    | `/admin/couriers/:courierId/verification-history`                      |
| GET    | `/admin/couriers/:courierId/audit-log`                                 |
| GET    | `/admin/merchants`                                                     |
| GET    | `/admin/merchants/:merchantId`                                         |
| POST   | `/admin/users/:userId/status`                                          |

Negative document and account decisions require `reason`. Review mutations
require the current `version` or `reviewVersion`.
