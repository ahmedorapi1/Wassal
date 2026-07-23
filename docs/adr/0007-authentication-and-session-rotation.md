# ADR 0007: OTP authentication and rotating sessions

- Status: Accepted
- Date: 2026-07-23

## Context

Phase 1 needs passwordless Egyptian-phone authentication, immediate account
revocation, and safe long-lived sessions without persisting usable credentials.

## Decision

Store peppered OTP HMACs with expiry and attempt limits. Rate-limit OTP actions
in Redis. Issue 15-minute HS256 access JWTs and opaque high-entropy refresh
tokens. Persist only refresh-token SHA-256 digests, rotate them atomically, and
revoke the session when the immediately previous token is replayed. Protected
requests verify both JWT and live database session.

## Consequences

Logout and account suspension are immediate and refresh secrets are not
recoverable from the database. Protected requests add one indexed session
lookup. Production must provide managed secrets and a non-mock OTP adapter.
