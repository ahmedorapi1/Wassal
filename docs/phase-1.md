Continue building the Wasel delivery platform from the fully verified Phase 0 and Phase 1 implementation.

First inspect the complete repository and read:

* README.md
* docs/product/phase-1-completion.md
* docs/api/phase-1-routes.md
* docs/architecture/README.md
* wasel_codex_product_spec.html
* infrastructure/database/prisma/schema.prisma
* all migrations
* all ADRs
* all shared package documentation
* the current Git history and Git status

Treat the existing implementation as the source of truth.

Preserve:

* The existing pnpm/Turborepo architecture
* NestJS API and worker structure
* Next.js merchant and admin applications
* Expo courier application
* PostgreSQL/PostGIS and Redis infrastructure
* Prisma migration history
* Existing immutable-record triggers
* Existing spatial indexes
* Existing provider abstractions
* Existing OTP and rotating-session implementation
* RBAC and ownership boundaries
* Arabic-first native RTL foundations
* Structured logging, validation, error handling, CI, and testing conventions
* All Phase 1 account, merchant, store, courier, document, and verification functionality

Implement Phase 2 only.

# Phase 2 objective

Implement:

1. Customers
2. Saved delivery addresses
3. Package and delivery-request details
4. Pricing rules
5. Delivery price quotes
6. Delivery order creation
7. The delivery order state machine
8. Order event history
9. Merchant order listing and details
10. Merchant cancellation
11. Admin order inspection
12. Order-level idempotency and concurrency protection
13. A complete merchant order-creation interface

By the end of Phase 2:

* An authorized merchant user can create or select a customer.
* The merchant can enter pickup and drop-off locations.
* The merchant can enter package and delivery details.
* The system can calculate and return a versioned price quote.
* The merchant can confirm a valid quote and create a delivery order.
* The order is stored with a complete immutable pricing snapshot.
* The merchant can view and cancel eligible orders.
* Admin users can inspect the order and its complete event timeline.
* The system supports the early order lifecycle up to `searching_courier`.
* No courier dispatch offer is created.
* No courier can see or accept an order.
* No live delivery workflow is implemented.

# Do not implement

Do not implement any Phase 3 or later functionality:

* Courier dispatch matching
* Dispatch offer generation
* Courier offer screens
* Courier acceptance or rejection
* Automatic courier assignment
* Manual courier assignment
* Courier online/offline availability
* Courier location tracking
* WebSockets for courier tracking
* Pickup confirmation
* Delivery confirmation
* Proof of delivery
* OTP delivery confirmation
* Ratings
* Courier earnings
* Wallet transactions
* Cash on delivery
* Cash ledgers
* Merchant settlements
* Courier payouts
* Scheduled delivery execution
* Multi-stop delivery
* Batched orders
* Surge pricing activation
* Subscriptions
* External merchant API
* Webhooks
* AI routing or forecasting

All five deferred production feature flags must remain disabled.

Cash on delivery must remain disabled.

# Delivery order state machine

Use the existing planned states:

* draft
* quoted
* searching_courier
* courier_assigned
* courier_arriving_pickup
* at_pickup
* picked_up
* in_transit
* at_dropoff
* delivered
* delivery_failed
* returning_to_store
* returned
* cancelled

Phase 2 may actively transition only through:

* draft
* quoted
* searching_courier
* cancelled

Later states must exist in the domain model and transition definitions where appropriate, but no Phase 3 or delivery-execution workflow may activate them.

Required Phase 2 transitions:

* draft → quoted
* quoted → quoted when a newer quote replaces an expired or changed quote
* quoted → searching_courier when the merchant confirms the order
* draft → cancelled where allowed
* quoted → cancelled where allowed
* searching_courier → cancelled according to cancellation policy

No other transition may be executed in Phase 2.

Create a centralized, testable order state-machine policy.

Never allow controllers or UI code to update order status directly.

# Customer domain

Implement merchant-scoped customers.

Required customer fields should include where appropriate:

* id
* merchantId
* name
* normalized phone number
* optional email
* notes
* status
* createdAt
* updatedAt

Required rules:

* Customers belong to a merchant.
* Merchant users cannot access another merchant’s customers.
* Phone numbers must be normalized.
* Customer duplication should be handled sensibly within one merchant.
* Do not globally expose whether a phone number already exists.
* Customers referenced by historical orders must not be physically deleted.
* Support active and archived status.
* Allow creating a customer during order creation.
* Allow selecting an existing customer.

Prepare the model for customer-specific saved addresses without adding unnecessary CRM complexity.

# Address domain

Implement saved and order-specific addresses.

Address fields should support:

* label
* contact name
* contact phone
* address text
* building number
* floor
* apartment
* landmark
* area
* city
* governorate
* delivery instructions
* latitude
* longitude
* PostGIS point
* source
* validation status

Required rules:

* Validate latitude and longitude.
* Store spatial data consistently using PostGIS.
* Pickup locations must resolve to a merchant store in the MVP flow.
* Drop-off addresses may be saved to the customer or used once.
* Orders must retain immutable address snapshots.
* Editing a saved address must not alter historical orders.
* Prepare the design for future map-provider geocoding.
* Use the existing map-provider abstraction or extend it without integrating a paid provider.
* Provide a local/mock distance and duration provider for development and tests.

# Package and delivery details

Support:

* Package category
* Short item description
* Size classification
* Approximate weight
* Quantity or package count
* Fragile flag
* Requires thermal bag flag
* Recipient notes
* Courier notes
* Declared product value
* Prohibited-item confirmation
* Optional internal merchant reference
* Optional customer order reference

Suggested initial categories:

* groceries
* food
* pharmacy
* documents
* clothing
* gifts
* electronics_accessories
* spare_parts
* other

Suggested initial package sizes:

* small
* medium
* large

Keep enums extensible.

Do not implement delivery of prohibited, illegal, hazardous, or unsupported goods.

Add configuration for maximum supported weight and declared value.

# Pricing rules

Build database-driven, versioned pricing.

Do not hard-code pricing inside controllers or frontend code.

Pricing rules should support:

* Country
* Governorate
* City
* Service zone
* Vehicle type
* Currency
* Base fee
* Included distance
* Per-kilometer rate
* Minimum delivery fee
* Maximum supported distance
* Package-size surcharge
* Weight surcharge or configurable weight bands
* Fragile-item surcharge
* Thermal-bag surcharge
* Waiting fee configuration for future use
* Return-trip configuration for future use
* Platform commission type
* Platform commission value
* Effective start date
* Effective end date
* Status
* Version
* Priority
* Tax configuration placeholder where appropriate

Required rules:

* Pricing must resolve deterministically.
* Only one applicable active rule should win after priority and specificity are considered.
* Overlapping pricing rules must be detected or handled explicitly.
* Past quotes and orders must retain the rule version and complete monetary breakdown.
* Editing a pricing rule creates a new version or preserves history.
* Historical rules cannot be silently overwritten.
* Support EGP initially.
* Use integer minor units for all money.
* Never use floating-point numbers for financial calculations.

Surge pricing must remain disabled.

Subscription discounts must remain disabled.

# Service zones

Use PostGIS service zones where appropriate.

Support:

* Named operational zones
* City and governorate association
* Polygon or multipolygon boundaries
* Active status
* Allowed pickup validation
* Allowed drop-off validation
* Maximum route distance
* Pricing-rule association

For the initial seed:

* Add synthetic Damietta service-zone data.
* Use non-sensitive, clearly synthetic demo geometry.
* Document how production polygons will be imported later.

Required behavior:

* Reject orders outside an active service zone.
* Explain the validation error safely to the merchant.
* Prepare for several zones in one city.
* Do not assume that an entire governorate is enabled.

# Distance and duration calculation

Create or extend a provider abstraction for:

* Route distance
* Estimated duration
* Coordinate validation
* Optional future route geometry

Implement:

* A deterministic local/mock provider for tests and local development.
* A production adapter interface without adding paid credentials.
* Clear documentation for replacing the mock provider later.

Do not calculate billable distance using a naive frontend calculation.

The backend must be the authority for the quoted distance and duration.

# Price quotes

Implement price quotes with:

* merchantId
* storeId
* customer or recipient details
* pickup address snapshot
* drop-off address snapshot
* package details
* route distance
* estimated duration
* service zone
* pricing rule version
* complete pricing breakdown
* merchant charge
* estimated courier earning placeholder
* platform commission
* currency
* expiration time
* quote status
* request fingerprint
* idempotency key
* createdBy
* createdAt

Required behavior:

* Quotes expire after a configurable duration.
* A changed pickup, drop-off, package, or pricing condition invalidates the prior quote.
* Expired quotes cannot create an order.
* A quote can be recalculated.
* Quote creation must support idempotency.
* Identical idempotent requests must return the original result.
* Reusing an idempotency key with different request data must be rejected.
* All monetary fields must be returned with a clear breakdown.
* The frontend must clearly show the total merchant charge before confirmation.

# Delivery order creation

A delivery order may be created only from a valid, unexpired quote.

Order creation must:

* Be transactional.
* Support an idempotency key.
* Verify merchant and store ownership.
* Verify store status.
* Verify service-zone eligibility.
* Copy immutable customer, pickup, drop-off, package, route, pricing, and monetary snapshots.
* Record the pricing-rule version.
* Create the first immutable OrderEvent records.
* Transition through the domain state machine.
* Finish in `searching_courier`.
* Not create any dispatch offer.
* Not assign any courier.

Order numbers should be:

* Human-readable
* Unique
* Non-sequential enough to avoid exposing business volume
* Suitable for customer support references

Do not use the database primary key as the visible order number.

# Order events

Every state change and significant action must create an immutable OrderEvent.

Each event should support:

* orderId
* event type
* previous status
* new status
* actor type
* actor ID
* timestamp
* optional coordinates
* source
* reason code
* merchant-visible message
* admin/internal message
* correlation ID
* metadata

Required event types should include:

* order_draft_created
* quote_created
* quote_recalculated
* quote_expired
* order_confirmed
* courier_search_requested
* order_cancelled
* order_note_updated
* admin_order_viewed where existing audit conventions require it

Do not expose internal metadata to merchant users.

# Cancellation policy

Implement a configurable, centralized cancellation policy.

For Phase 2:

* A draft order may be cancelled.
* A quoted order may be cancelled.
* An order in `searching_courier` may be cancelled if no courier has been assigned.
* Later states must be rejected by the Phase 2 cancellation policy.
* Cancellation requires a reason.
* Merchant cancellation and admin cancellation must be distinguishable.
* Cancellation must create immutable order and audit events.
* Cancellation must be transactional and concurrency-safe.
* Repeated cancellation requests must be idempotent.
* A cancelled order cannot be reactivated.

Prepare placeholders for future cancellation fees, but do not charge any fees in Phase 2.

Suggested cancellation reason codes:

Merchant:

* customer_cancelled
* wrong_address
* duplicate_order
* order_not_ready
* incorrect_details
* no_longer_needed
* other

Admin:

* merchant_request
* suspected_fraud
* unsupported_item
* service_area_issue
* operational_issue
* duplicate_order
* other

Require free-text details when `other` is selected.

# Authorization

Enforce all rules in the API.

Merchant roles:

merchant_owner:

* Full access to merchant orders and pricing quotes.

merchant_manager:

* Create, view, and cancel orders.

merchant_staff:

* Create and view orders.
* Cancellation should follow explicit permission configuration or default to restricted behavior.

Courier:

* No access to merchant orders in Phase 2.
* No delivery offers or order discovery endpoints.

support_agent:

* Read appropriate order and customer-support information.
* No direct pricing-rule modification.

operations_admin:

* View all orders.
* Cancel orders with required reason and audit logging.
* View service zones and pricing configuration.

finance_admin:

* View pricing breakdowns.
* No operational state manipulation unless separately authorized.

super_admin:

* Full Phase 2 administrative access.

Add positive and negative authorization tests.

# Merchant API

Implement versioned REST endpoints consistent with repository conventions.

At minimum, support equivalents of:

Customers:

* POST /merchant/customers
* GET /merchant/customers
* GET /merchant/customers/:customerId
* PATCH /merchant/customers/:customerId
* POST /merchant/customers/:customerId/archive
* POST /merchant/customers/:customerId/restore

Addresses:

* POST /merchant/customers/:customerId/addresses
* GET /merchant/customers/:customerId/addresses
* PATCH /merchant/customers/:customerId/addresses/:addressId
* POST /merchant/customers/:customerId/addresses/:addressId/archive

Quotes:

* POST /orders/quotes
* GET /orders/quotes/:quoteId
* POST /orders/quotes/:quoteId/recalculate

Orders:

* POST /orders
* GET /orders
* GET /orders/:orderId
* POST /orders/:orderId/cancel
* GET /orders/:orderId/events

The exact route structure may be adjusted to match existing conventions. Document all final routes.

# Admin API

Implement equivalents of:

Service zones:

* POST /admin/service-zones
* GET /admin/service-zones
* GET /admin/service-zones/:zoneId
* PATCH /admin/service-zones/:zoneId
* POST /admin/service-zones/:zoneId/activate
* POST /admin/service-zones/:zoneId/deactivate

Pricing:

* POST /admin/pricing-rules
* GET /admin/pricing-rules
* GET /admin/pricing-rules/:ruleId
* POST /admin/pricing-rules/:ruleId/new-version
* POST /admin/pricing-rules/:ruleId/activate
* POST /admin/pricing-rules/:ruleId/deactivate
* POST /admin/pricing-rules/validate-overlaps

Orders:

* GET /admin/orders
* GET /admin/orders/:orderId
* GET /admin/orders/:orderId/events
* POST /admin/orders/:orderId/cancel

Add pagination, filters, and safe sorting.

Recommended order filters:

* order number
* merchant
* store
* customer phone
* status
* service zone
* creation date range
* cancellation reason

# Merchant web interface

Build complete functional Phase 2 merchant screens.

Required screens:

1. Merchant dashboard

   * Basic Phase 2 statistics
   * Create delivery request CTA
   * Recent orders
   * Empty states

2. New delivery request

   * Select store
   * Select or create customer
   * Enter customer phone
   * Select saved address or enter a new address
   * Pick drop-off location on a map abstraction
   * Add address details and landmark
   * Select package category and size
   * Add weight, quantity, flags, references, and notes
   * Confirm prohibited-item declaration

3. Price quote

   * Distance
   * Estimated duration
   * Full price breakdown
   * Merchant total
   * Quote expiry countdown
   * Recalculate action
   * Confirm-order action

4. Order searching screen

   * Clearly indicate that the order was created
   * Show `searching_courier`
   * Do not simulate courier assignment
   * Do not fabricate tracking data
   * Explain that dispatch comes in Phase 3 in development/demo mode only

5. Order list

   * Status
   * Order number
   * Customer
   * Store
   * Price
   * Date
   * Filters and pagination

6. Order details

   * Customer details
   * Pickup and drop-off
   * Package information
   * Price breakdown
   * Current status
   * Merchant-visible event timeline
   * Cancellation action where allowed

7. Customer list

   * Search
   * Add
   * Edit
   * Archive
   * View saved addresses

The interface must remain:

* Arabic-first
* Native RTL
* Responsive
* Accessible
* Keyboard usable
* Clear on mobile browsers
* Based on the existing shared UI package

Do not create fake courier maps or fake courier cards.

# Admin web interface

Build:

1. Phase 2 dashboard additions

   * Orders created today
   * Orders by active Phase 2 status
   * Quote conversion rate
   * Cancelled orders
   * Quote expiry count
   * Orders by zone

2. Order list

   * Full filtering
   * Pagination
   * Status labels
   * Order number
   * Merchant/store/customer
   * Pricing total
   * Creation time

3. Order details

   * Full immutable snapshots
   * Pricing breakdown
   * Pricing-rule version
   * Route information
   * Event timeline
   * Cancellation controls
   * Relevant audit logs

4. Service-zone management

   * List
   * Details
   * Create/edit
   * Activate/deactivate
   * Geometry input suitable for local development
   * Safe validation feedback

5. Pricing-rule management

   * List versions
   * Create a new rule
   * Create a new version
   * Activate/deactivate
   * Overlap-validation feedback
   * Preview calculations

Do not add courier assignment controls.

# Courier application

Do not add order offers.

Only update the approved-courier home screen with a clear Phase 2 placeholder stating that courier availability and delivery offers are not active yet.

Do not add:

* Online toggle
* Incoming offer UI
* Order details
* Navigation
* Earnings
* Tracking

# Database and migrations

Review and reuse the existing schema before adding entities.

Requirements:

* Create a new Phase 2 migration.
* Never edit or delete Phase 0 or Phase 1 migrations.
* Preserve all existing indexes and immutable triggers.
* Add database constraints for financial amounts and coordinates.
* Add relevant foreign keys and status checks.
* Add indexes for:

  * merchant customer lookup
  * normalized customer phone
  * saved addresses
  * quote expiration
  * quote status
  * order number
  * merchant order listing
  * order status
  * service-zone queries
  * pricing-rule resolution
  * order events
  * cancellation reporting
* Add PostGIS indexes for service-zone polygons and address points.
* Use transactions for quote confirmation and order creation.
* Keep immutable history records protected.
* Keep seed data idempotent.

Extend synthetic seed data with:

* Damietta demo service zone
* Active EGP pricing rule
* Merchant customers
* Saved customer addresses
* Draft order
* Quoted order
* Searching-for-courier order
* Cancelled order
* Historical pricing-rule version
* Expired quote
* Active quote

Do not use real personal data.

# Financial integrity

All money must:

* Use integer minor units
* Specify currency
* Have explicit calculation components
* Be calculated by the backend
* Be copied into immutable quote and order snapshots
* Use deterministic rounding
* Be covered by unit tests

Do not create wallet movements or payment transactions.

The pricing breakdown should distinguish:

* Base fee
* Distance charge
* Package surcharge
* Weight surcharge
* Fragile surcharge
* Thermal-bag surcharge
* Discounts, fixed to zero while disabled
* Surge adjustment, fixed to zero while disabled
* Tax placeholder where configured
* Merchant total
* Estimated courier earning
* Platform commission

# Concurrency and idempotency

Implement and test:

* Quote-request idempotency
* Order-creation idempotency
* Cancellation idempotency
* Reuse of an idempotency key with conflicting payload
* Concurrent quote confirmation
* Concurrent order cancellation
* Expired quote confirmation
* Pricing-rule change after quote creation
* Store deactivation between quote and confirmation
* Service-zone change between quote and confirmation

Ensure only one delivery order can be created from a one-time quote unless the domain explicitly supports otherwise.

# Security and privacy

Implement:

* Ownership checks
* RBAC
* Input validation
* Safe customer-data exposure
* Phone masking in admin lists where appropriate
* Full access only in authorized order details
* Rate limits for quote generation and order creation
* Maximum request sizes
* Safe logs that do not expose full customer phone numbers or addresses
* Audit logs for pricing, zone, cancellation, and sensitive admin actions
* Safe public error messages
* No secrets in Git
* CSRF/session protections consistent with existing architecture

# Testing

Add meaningful tests.

Unit tests:

* Customer phone normalization
* Customer ownership
* Coordinate validation
* Service-zone containment
* Pricing-rule resolution
* Pricing-rule specificity and priority
* Overlapping rule detection
* Money calculation and rounding
* Quote expiration
* Quote fingerprinting
* Quote idempotency
* Order-state transitions
* Invalid order-state transitions
* Cancellation policy
* Cancellation reason validation
* Order-number generation
* Immutable snapshot creation

Integration tests using real PostgreSQL/PostGIS and Redis:

* Create customer and saved address
* Deny cross-merchant customer access
* Resolve a service zone
* Reject out-of-zone pickup
* Reject out-of-zone delivery
* Generate a valid quote
* Recalculate a quote
* Reject an expired quote
* Create an order from a valid quote
* Confirm immutable pricing and address snapshots
* Prevent duplicate order creation
* Reject conflicting idempotency-key reuse
* Cancel a searching order
* Prevent cancellation after an invalid simulated later state
* Validate concurrent quote confirmation
* Validate pricing-version history
* Validate admin order access
* Validate merchant staff permissions

UI/end-to-end tests:

* Merchant creates a customer and delivery request
* Merchant receives a quote and confirms an order
* Merchant views and cancels an eligible order
* Admin creates and activates a pricing rule
* Admin views an order timeline
* Arabic RTL rendering
* Mobile-responsive order-creation flow

Do not claim tests passed unless they were actually executed.

# Documentation

Create or update:

* Phase 2 implementation plan
* Phase 2 completion report
* Order domain model
* Order state-machine documentation
* Customer and address design
* Service-zone design
* Pricing-rule resolution documentation
* Quote lifecycle documentation
* Cancellation-policy documentation
* Phase 2 API routes
* Database diagram
* RBAC matrix
* Provider integration documentation
* Seed/demo-persona documentation
* README setup and usage instructions
* ADRs for significant architectural decisions

Document clearly that:

* Phase 2 does not perform dispatch.
* `searching_courier` is the terminal active state for this phase.
* COD and financial settlements remain disabled.

# Completion requirements

Before declaring Phase 2 complete:

1. Run formatting.
2. Run linting.
3. Run all workspace type checks.
4. Run all unit tests.
5. Run integration tests against real local PostgreSQL/PostGIS and Redis.
6. Run the critical UI/end-to-end journeys.
7. Build every application and package.
8. Export the Expo Android application if part of the existing verification process.
9. Apply all migrations from a clean database.
10. Run the seed twice to prove idempotency.
11. Confirm PostGIS indexes and immutable triggers.
12. Start the production API bundle and verify the health endpoint.
13. Start the production worker and verify Redis connectivity.
14. Verify merchant and admin application production builds.
15. Verify all five future feature flags remain disabled.
16. Verify no dispatch offers exist.
17. Verify no courier assignment or tracking functionality was added.
18. Inspect Git status and list every changed file.
19. Do not create a Git commit unless explicitly requested.

At the end report:

* Exactly what was implemented
* Migration name and schema changes
* API routes created
* Screens created
* Tests added
* Commands actually run
* Real verification output
* Spatial indexes and immutable triggers verified
* Feature-flag states
* Any limitations or risks
* What remains for Phase 3

Never fabricate successful results.
Do not silently reduce scope.
Do not implement Phase 3.
