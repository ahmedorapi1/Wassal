Continue building the Wasel delivery platform from the completed Phase 0 foundation.

First, inspect the entire repository and read these files carefully:

- README.md
- docs/product/phase-0-plan.md
- docs/architecture/README.md
- wasel_codex_product_spec.html
- infrastructure/database/prisma/schema.prisma
- all existing ADRs
- all shared package documentation

Treat the existing Phase 0 implementation as the source of truth. Preserve the current architecture, package boundaries, Arabic-first RTL foundations, provider abstractions, logging, validation, testing, and CI setup.

Implement Phase 1 only.

Do not implement:

- Delivery order creation
- Pricing quotes
- Dispatch workflows
- Courier live tracking
- Pickup or delivery workflows
- Wallet transactions
- Cash on delivery
- Settlements
- Ratings
- Scheduled deliveries
- Multi-stop deliveries
- Subscriptions
- Surge pricing

All deferred feature flags must remain disabled.

# Phase 1 objective

Build the complete identity and onboarding foundation for:

1. Authentication and sessions
2. Role-based access control
3. Merchants
4. Stores
5. Merchant staff
6. Couriers
7. Vehicles
8. Courier documents
9. Admin courier verification
10. User account status management
11. Audit logging for sensitive actions

By the end of this phase:

- A merchant must be able to register, authenticate, create a merchant organization, create a store, and manage basic store information.
- A merchant owner must be able to invite or create store staff with restricted roles.
- A courier must be able to register, complete a courier profile, register a motorcycle, and upload required document metadata/files through the existing storage abstraction.
- An admin must be able to review courier profiles and documents, approve them, reject them with a reason, request resubmission, suspend them, and reactivate them.
- An unapproved courier must not be allowed to become operationally available.
- All sensitive administrative and verification actions must create immutable audit records.

# Authentication

Complete the authentication flow using the existing OTP provider abstraction.

Required functionality:

- Request OTP
- Verify OTP
- Create or resolve a user account using a normalized Egyptian phone number
- Issue secure access and refresh sessions
- Refresh a session
- Revoke the current session
- Revoke all sessions for a user
- Return the authenticated user through GET /me
- Store only hashed OTP values if OTP persistence is needed
- Add OTP expiration, attempt limits, resend cooldown, and rate limiting
- Prevent phone-number enumeration where reasonably possible
- Keep the local mock OTP provider for development
- Do not integrate a paid production SMS provider yet

Use secure defaults and document the production provider integration point.

# RBAC

Use the existing contracts and RBAC package.

Support these roles where applicable:

- merchant_owner
- merchant_manager
- merchant_staff
- courier
- support_agent
- operations_admin
- finance_admin
- super_admin

Required rules:

- Merchant users may only access their own merchant and stores.
- Merchant staff permissions must be restricted according to role.
- Couriers may only access their own courier profile, vehicle, documents, and verification status.
- Support agents may view relevant accounts but must not approve financial or verification-sensitive operations unless explicitly authorized.
- Operations admins may review and manage courier verification.
- Super admins may perform all administrative actions.
- Every authorization rule must be enforced in the API, not only hidden in the user interface.

Add automated authorization tests for both allowed and forbidden operations.

# Merchant domain

Implement:

- Merchant organization creation
- Merchant profile retrieval and update
- Store creation
- Store retrieval
- Store update
- Store activation and deactivation
- Store address and PostGIS location
- Store operating hours
- Merchant staff membership
- Staff role assignment
- Staff activation and deactivation

Business rules:

- The user creating a merchant becomes merchant_owner.
- A merchant must have at least one active owner.
- A merchant user cannot access another merchant by changing identifiers.
- Store coordinates must be validated.
- Deactivated stores remain in historical records.
- Do not physically delete merchant or store records that may be referenced later.
- Prepare the schema for multiple stores even if the initial UI emphasizes one store.

# Courier domain

Implement:

- Courier profile creation and update
- Courier profile status
- Emergency contact fields if already supported by the schema
- Vehicle creation and update
- Motorcycle as the initial supported vehicle type
- Vehicle activation and deactivation
- Courier document registration
- Secure document upload using the existing storage provider abstraction
- Document metadata
- Document type
- Document number where applicable
- Issue date
- Expiry date
- Review status
- Rejection or resubmission reason
- File checksum and MIME validation
- File size limits
- Prevention of unauthorized document access

Required document types for the MVP foundation:

- National ID front
- National ID back
- Driver licence
- Vehicle licence
- Courier profile photo

Keep document types extensible through enums or configuration.

Courier verification statuses should support at least:

- incomplete
- pending_review
- changes_requested
- approved
- rejected
- suspended

Business rules:

- A courier may edit incomplete or changes-requested information.
- Submitted documents must not silently change while under review.
- Replacing a submitted document must create a new version or retain review history.
- An approved courier becoming invalid due to an expired required document must be detectable.
- An unapproved, rejected, suspended, or document-expired courier cannot become available.
- Approval must require all configured required documents to be valid.
- Rejection and changes-requested actions require a reason.

Do not implement delivery availability or dispatch yet, but implement the domain method or policy that determines whether the courier is eligible to become available later.

# Admin verification workflow

Implement an admin workflow for:

- Listing pending courier applications
- Filtering by status
- Viewing courier profile, vehicle, and document details
- Viewing document files through secure authorized URLs
- Approving individual documents
- Rejecting individual documents
- Requesting document replacement
- Approving the complete courier account
- Rejecting the complete application
- Suspending an approved courier
- Reactivating a suspended courier where valid
- Viewing full verification history
- Viewing relevant audit history

Prevent contradictory concurrent review actions using transactions, version fields, or optimistic concurrency control.

# API endpoints

Design and implement clean versioned REST endpoints consistent with the existing repository conventions.

At minimum, support endpoints equivalent to:

Authentication:

- POST /auth/request-otp
- POST /auth/verify-otp
- POST /auth/refresh
- POST /auth/logout
- POST /auth/logout-all
- GET /me

Merchant:

- POST /merchants
- GET /merchants/current
- PATCH /merchants/current
- POST /merchants/current/stores
- GET /merchants/current/stores
- GET /merchants/current/stores/:storeId
- PATCH /merchants/current/stores/:storeId
- POST /merchants/current/staff
- GET /merchants/current/staff
- PATCH /merchants/current/staff/:membershipId

Courier:

- POST /couriers/profile
- GET /couriers/profile
- PATCH /couriers/profile
- POST /couriers/vehicles
- GET /couriers/vehicles
- PATCH /couriers/vehicles/:vehicleId
- POST /couriers/documents
- GET /couriers/documents
- POST /couriers/documents/:documentId/replacement
- POST /couriers/submit-for-review
- GET /couriers/verification-status

Admin:

- GET /admin/couriers
- GET /admin/couriers/:courierId
- GET /admin/couriers/:courierId/documents
- POST /admin/couriers/:courierId/documents/:documentId/approve
- POST /admin/couriers/:courierId/documents/:documentId/reject
- POST /admin/couriers/:courierId/documents/:documentId/request-replacement
- POST /admin/couriers/:courierId/approve
- POST /admin/couriers/:courierId/reject
- POST /admin/couriers/:courierId/suspend
- POST /admin/couriers/:courierId/reactivate
- GET /admin/couriers/:courierId/verification-history
- GET /admin/couriers/:courierId/audit-log

The exact route names may be adjusted to match existing conventions, but document any differences.

# User interfaces

Implement functional Phase 1 interfaces only.

## Merchant web

Required screens:

- Phone authentication
- OTP verification
- Merchant onboarding
- Store setup
- Merchant profile
- Store details and editing
- Staff list
- Add staff or invite staff
- Staff role and status management
- Empty dashboard placeholder explaining that delivery orders will arrive in Phase 2

The interface must be Arabic-first, native RTL, responsive, accessible, and usable on mobile browsers.

## Courier mobile

Required screens:

- Phone authentication
- OTP verification
- Courier onboarding progress
- Personal information
- Vehicle information
- Document upload
- Submission review
- Verification pending
- Changes requested
- Approved
- Rejected
- Suspended
- Profile and document status

Do not add online/offline availability or delivery offers yet.

Use the mock OTP and storage providers in local development.

## Admin web

Required screens:

- Admin sign-in
- Phase 1 dashboard summary
- Pending courier applications
- Courier application details
- Document review
- Approve, reject, and request-resubmission actions
- Approved couriers
- Rejected and suspended couriers
- Merchant list
- Merchant details
- Audit history

The admin UI must visibly require a reason for rejection, suspension, and resubmission requests.

# Database and migrations

Review the existing Prisma schema before changing it.

- Reuse existing entities where possible.
- Add only migrations needed for Phase 1.
- Never rewrite or delete the existing Phase 0 migration.
- Preserve immutable-record triggers and spatial indexes.
- Add indexes for phone lookup, merchant membership, courier verification queues, document status, expiry dates, and audit queries.
- Use transactions for multi-record onboarding and verification operations.
- Ensure seeds remain idempotent.
- Extend demo seed data with:

  - One merchant owner
  - One merchant manager
  - One merchant staff user
  - One configured store
  - One incomplete courier
  - One pending courier
  - One approved courier
  - One changes-requested courier
  - One operations admin
  - One super admin

Do not store real personal information in seed data.

# Security

Implement and verify:

- Input validation
- Phone normalization
- Authentication guards
- Resource ownership checks
- RBAC guards
- Rate limiting
- Secure session storage
- Refresh-token rotation or equivalent secure session design
- Secure document access
- Upload signature/MIME validation
- Upload size limits
- File-name sanitization
- Prevention of path traversal
- Audit logging
- Safe error messages
- Environment validation
- No secrets committed to Git

Document any security trade-offs left for production deployment.

# Testing

Add meaningful automated tests.

At minimum:

Unit tests:

- Phone normalization
- OTP expiration and attempt logic
- RBAC policy checks
- Merchant ownership rules
- Store coordinate validation
- Courier verification state transitions
- Required-document validation
- Courier operational eligibility policy
- Rejection reason requirements

Integration tests:

- Merchant registration and store creation
- Cross-merchant access denial
- Courier onboarding and submission
- Admin document review
- Full courier approval
- Rejection and resubmission
- Suspension and reactivation
- Concurrent verification protection
- Secure document authorization
- Session refresh and revocation

UI tests:

- Critical merchant onboarding flow
- Critical courier onboarding flow
- Critical admin courier approval flow
- Arabic RTL rendering checks

Do not claim tests passed without executing them.

# Documentation

Create or update:

- Phase 1 implementation plan
- Phase 1 domain model
- Authentication and session documentation
- RBAC matrix
- Courier verification workflow
- Document security design
- API documentation
- Updated database diagram
- Updated README setup and demo credentials
- Phase 1 completion report

Add ADRs for any significant new architectural decisions.

# Completion requirements

Before declaring Phase 1 complete:

1. Run formatting.
2. Run linting.
3. Run type checking.
4. Run all unit tests.
5. Run integration tests against the real local PostgreSQL/PostGIS and Redis services.
6. Run UI or end-to-end tests for the three critical onboarding/review journeys.
7. Build every affected application and package.
8. Apply migrations from a clean database.
9. Run the seed twice to prove idempotency.
10. Start the production API bundle and verify its health endpoint.
11. Start the worker bundle and verify Redis connectivity.
12. Confirm all deferred feature flags remain disabled.
13. Confirm no Phase 2 delivery-order workflow was implemented.
14. Inspect Git status and provide the list of changed files.

At the end, report:

- Exactly what was implemented
- Database migrations created
- API routes created
- Screens created
- Tests added
- Commands actually run
- Real verification results
- Any limitations or risks
- What remains for Phase 2

Do not create a Git commit unless explicitly requested.
