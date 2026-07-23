# Phase 1 identity and organization model

## Identity

`User` is the global login identity. A user has one platform role and an account
status. `Session` stores only a SHA-256 refresh-token digest, supports one-token
rotation history for replay detection, and can be revoked immediately.
`OtpChallenge` stores a peppered HMAC rather than an OTP.

Public role names deliberately describe their scope:

- `merchant_owner`, `merchant_manager`, `merchant_staff`
- `courier`
- `support_agent`, `operations_admin`, `finance_admin`, `super_admin`

The database retains the shorter Phase 0 enum values. `@wasel/contracts`
contains the only public-to-database mapping.

## Merchant tenancy

A `MerchantMembership` links a user to a merchant. It owns the merchant role,
active/deactivated state, inviter, and concurrency version. Every merchant
query first resolves an active membership; identifiers supplied by a client are
then constrained by that merchant ID.

A merchant must always retain at least one active owner. Records are deactivated
rather than physically deleted. Stores carry a PostGIS geography point,
structured operating hours, active/inactive state, and a version.

## Courier identity

A courier user has one `CourierProfile`, one or more motorcycle records, and a
history of documents. A profile is independently versioned from its documents.
The verification state is:

`INCOMPLETE → PENDING_REVIEW → APPROVED`

Review can instead produce `CHANGES_REQUESTED` or `REJECTED`. An approved
profile can become `SUSPENDED` and can only be reactivated when its required
documents and active motorcycle remain valid.

## Audit separation

`AuditLog` captures security-sensitive mutations across domains.
`CourierVerificationEvent` is the append-only business history of review
decisions. Both tables are protected by database triggers that reject updates
and deletes.
