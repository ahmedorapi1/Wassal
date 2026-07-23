# ADR 0002: Use a pnpm TypeScript monorepo

- Status: Accepted
- Date: 2026-07-23

## Context

The product has two web apps, one mobile app, an API, a worker, and shared contracts.

## Decision

Use pnpm workspaces and Turborepo with strict TypeScript. Share only stable
contracts, configuration, validation, localization, UI primitives, provider
ports, observability, and database access. Keep app-specific behavior in its app.

## Consequences

Tooling and domain vocabulary stay consistent. Workspace dependency cycles and
overly broad shared packages must be prevented in review.
