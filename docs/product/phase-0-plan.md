# Phase 0 implementation plan

## Goal

Create a reproducible, production-oriented foundation that makes Phase 1 safe to
start without implementing Phase 1 behavior.

## Workstreams

1. **Workspace and quality** — pnpm workspaces, Turborepo, strict TypeScript,
   ESLint, Prettier, Vitest, GitHub Actions, and pinned runtime versions.
2. **Application shells** — NestJS API, BullMQ worker, Next.js admin and merchant
   shells, and Expo courier shell.
3. **Shared foundations** — environment validation, RBAC contracts, Arabic-first
   localization, logical-direction CSS, UI primitives, validation, logging,
   normalized errors, and an audit writer contract.
4. **Provider ports** — maps, OTP, notifications, payments, object storage, and
   phone masking interfaces plus a non-production OTP mock.
5. **Infrastructure and data** — Docker Compose for PostGIS and Redis, Prisma
   schema, first migration, spatial/immutability safeguards, and idempotent demo seed.
6. **Documentation** — architecture, data, API conventions, ADRs, and exact
   Windows/Linux onboarding steps.
7. **Verification** — install, generate, format check, lint, typecheck, tests,
   builds, Compose validation, migration deploy/status, and repeated seed.

## Phase boundary

The following are intentionally deferred:

- OTP HTTP flows, sessions/tokens, guards, and user administration
- merchant/store/courier/document use cases and admin verification
- price calculation and quote APIs
- order commands, transition policy, cancellation, and events
- dispatch selection/acceptance and concurrency control
- realtime tracking and notifications
- pickup/delivery proof, ratings, ledgers, settlements, reports, and finished UIs

The schema and shared contracts anticipate these areas. Anticipating a model is
not authorization to implement its behavior in Phase 0.
