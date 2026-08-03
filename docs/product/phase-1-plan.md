# Phase 1 implementation plan

Status: implemented on 2026-07-23.

Phase 1 delivers identity, merchant setup, courier onboarding, document review,
and administration. The product and architecture specification in
`wasel_codex_product_spec.html` remains the authoritative WASSAL specification.

## Scope boundary

Included:

- Egyptian phone normalization and OTP authentication
- access and rotating refresh sessions
- platform RBAC and merchant-scoped membership authorization
- merchant profile, stores, operating hours, and staff
- courier profile, motorcycles, versioned documents, and submission
- administrator document decisions and courier account transitions
- account suspension/reactivation, audit records, and verification history
- Arabic-first responsive merchant, courier, and admin interfaces

Explicitly excluded:

- order creation and pricing quotes
- courier online/offline state and dispatch
- tracking, pickup, delivery, or proof of delivery
- wallet/ledger transactions, COD, and settlements
- ratings, scheduled delivery, multi-stop, subscriptions, or surge pricing

Every corresponding feature flag remains disabled.

## Delivery slices

1. Extend, but do not rewrite, the Phase 0 schema and migration history.
2. Centralize public roles, phone normalization, Phase 1 contracts, and eligibility policy.
3. Implement OTP/session security and authentication/RBAC guards.
4. Implement tenant-scoped merchant, store, and membership services.
5. Implement private courier document storage, versioning, and review submission.
6. Implement transactional administrator review with optimistic concurrency.
7. Connect the Arabic/RTL clients to the Phase 1 APIs.
8. Verify unit, HTTP integration, UI rendering, migrations, seed idempotency,
   builds, production health, Redis worker connectivity, and disabled flags.

The exact verification evidence is recorded in
[the Phase 1 completion report](phase-1-completion.md).
