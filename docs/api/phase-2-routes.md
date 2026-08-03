# Phase 2 API routes

All routes use the `/api/v1` prefix, bearer access tokens, existing rotating
sessions, JSON unless noted, and the standard error envelope. Mutation
idempotency keys are sent as `Idempotency-Key` (16–128 characters).

## Merchant customers and addresses

| Method | Route                                                          | Roles                 |
| ------ | -------------------------------------------------------------- | --------------------- |
| POST   | `/merchant/customers`                                          | owner, manager, staff |
| GET    | `/merchant/customers?search=&status=`                          | owner, manager, staff |
| GET    | `/merchant/customers/:customerId`                              | owner, manager, staff |
| PATCH  | `/merchant/customers/:customerId`                              | owner, manager, staff |
| POST   | `/merchant/customers/:customerId/archive`                      | owner, manager        |
| POST   | `/merchant/customers/:customerId/restore`                      | owner, manager        |
| POST   | `/merchant/customers/:customerId/addresses`                    | owner, manager, staff |
| GET    | `/merchant/customers/:customerId/addresses`                    | owner, manager, staff |
| PATCH  | `/merchant/customers/:customerId/addresses/:addressId`         | owner, manager, staff |
| POST   | `/merchant/customers/:customerId/addresses/:addressId/archive` | owner, manager, staff |

Customer/address reads and writes are always constrained by the authenticated
merchant membership. Updates carry a positive `version`.

## Merchant quotes and orders

| Method | Route                                     | Roles                 | Notes                              |
| ------ | ----------------------------------------- | --------------------- | ---------------------------------- |
| POST   | `/orders/quotes`                          | owner, manager, staff | Idempotent quote request           |
| GET    | `/orders/quotes/:quoteId`                 | owner, manager, staff | Tenant-scoped                      |
| POST   | `/orders/quotes/:quoteId/recalculate`     | owner, manager, staff | New idempotent quote               |
| POST   | `/orders`                                 | owner, manager, staff | `{ quoteId }`, idempotent          |
| GET    | `/orders?page=&pageSize=&status=&search=` | owner, manager, staff | Safe newest-first pagination       |
| GET    | `/orders/:orderId`                        | owner, manager, staff | Includes merchant-safe events      |
| GET    | `/orders/:orderId/events`                 | owner, manager, staff | Internal messages/metadata removed |
| POST   | `/orders/:orderId/cancel`                 | owner, manager        | Reason, version, idempotency key   |

The quote body chooses an existing customer or provides new customer data,
chooses a saved address or provides a one-use/saveable address, and supplies
the full package declaration. Order confirmation accepts only a valid,
unexpired quote.

## Admin service zones

| Method | Route                                     | Read roles                          | Mutation roles |
| ------ | ----------------------------------------- | ----------------------------------- | -------------- |
| GET    | `/admin/service-zones`                    | support, operations, finance, super | —              |
| GET    | `/admin/service-zones/:zoneId`            | support, operations, finance, super | —              |
| POST   | `/admin/service-zones`                    | —                                   | super          |
| PATCH  | `/admin/service-zones/:zoneId`            | —                                   | super          |
| POST   | `/admin/service-zones/:zoneId/activate`   | —                                   | super          |
| POST   | `/admin/service-zones/:zoneId/deactivate` | —                                   | super          |

Geometry accepts SRID-4326 GeoJSON `Polygon` or `MultiPolygon`. Update bodies
include `version`.

## Admin pricing

| Method | Route                                      | Read roles                          | Mutation roles |
| ------ | ------------------------------------------ | ----------------------------------- | -------------- |
| GET    | `/admin/pricing-rules`                     | support, operations, finance, super | —              |
| GET    | `/admin/pricing-rules/:ruleId`             | support, operations, finance, super | —              |
| POST   | `/admin/pricing-rules`                     | —                                   | super          |
| POST   | `/admin/pricing-rules/:ruleId/new-version` | —                                   | super          |
| POST   | `/admin/pricing-rules/:ruleId/activate`    | —                                   | super          |
| POST   | `/admin/pricing-rules/:ruleId/deactivate`  | —                                   | super          |
| POST   | `/admin/pricing-rules/validate-overlaps`   | —                                   | super          |

Money inputs are EGP integer minor units. Percentage commission and tax use
basis points.

## Admin orders

| Method | Route                           | Roles                               |
| ------ | ------------------------------- | ----------------------------------- |
| GET    | `/admin/phase-2/dashboard`      | support, operations, finance, super |
| GET    | `/admin/orders`                 | support, operations, finance, super |
| GET    | `/admin/orders/:orderId`        | support, operations, finance, super |
| GET    | `/admin/orders/:orderId/events` | support, operations, finance, super |
| POST   | `/admin/orders/:orderId/cancel` | operations, super                   |

Admin list filters: `page`, `pageSize`, `orderNumber`, `merchantId`, `storeId`,
`customerPhone`, Phase 2 `status`, `serviceZoneId`, `cancellationReason`,
`createdFrom`, and `createdTo`. List phones are masked; authorized details
contain the immutable support snapshot. Cancellation requires an admin reason,
client version, and idempotency key.

There are no courier order, offer, availability, assignment, or tracking
routes in Phase 2.
