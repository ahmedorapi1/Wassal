# ADR 0004: Place external systems behind provider ports

- Status: Accepted
- Date: 2026-07-23

## Context

Egyptian availability, pricing, and reliability may require changing maps, SMS,
payments, storage, push, or phone-masking vendors.

## Decision

Domain/application services depend on provider interfaces owned by WASSAL. Vendor
SDKs are isolated in adapters selected by the composition root. The local mock
OTP adapter refuses to run in production.

## Consequences

Vendors can be replaced and tests can use deterministic fakes. Port design must
remain business-oriented and avoid becoming a copy of one vendor's API.
