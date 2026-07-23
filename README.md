# Wasel

Wasel is an Arabic-first, on-demand delivery platform for Egypt. Merchants
create delivery requests and independent motorcycle couriers accept, collect,
and deliver them. This repository currently contains the production foundation
and **Phase 1: identity, merchant setup, courier onboarding, and verification**.

## Phase 1 status

Included:

- pnpm/Turborepo TypeScript monorepo with NestJS, Next.js, Expo, and a BullMQ worker
- PostgreSQL 18 + PostGIS 3.6 and Redis 8 Docker services
- OTP authentication, rotating refresh sessions, logout/revocation, and `/me`
- public RBAC roles plus merchant tenant and resource-ownership checks
- merchant profile, PostGIS stores, operating hours, and staff management
- courier profile, motorcycle, private/versioned documents, and review submission
- transactional administrator verification, user status, audit, and history
- connected Arabic-first/RTL merchant, courier, and admin interfaces
- real PostgreSQL/Redis integration tests and deterministic Phase 1 seeds

Not included: orders, pricing execution, dispatch, availability, tracking,
delivery proof, wallet transactions, COD, settlements, ratings, reports,
scheduled delivery, multi-stop, subscriptions, or surge. These belong to later
phases and their feature flags remain disabled.

## Prerequisites

- Node.js 24 LTS
- pnpm 11.9 or newer
- Docker Desktop (Windows/macOS) or Docker Engine with Compose (Linux)
- Git

The repository pins pnpm in `package.json`. If pnpm is not installed, enable it
with Corepack:

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

## Local setup — Windows PowerShell

From the repository root:

```powershell
Copy-Item .env.example .env
pnpm.cmd install
pnpm.cmd infra:up
pnpm.cmd db:generate
pnpm.cmd db:deploy
pnpm.cmd db:seed
pnpm.cmd check
```

PowerShell may block `pnpm.ps1` under a restrictive execution policy. Using
`pnpm.cmd`, as shown above, does not require changing the machine policy.

Start one application per terminal:

```powershell
pnpm.cmd dev:api
pnpm.cmd dev:admin
pnpm.cmd dev:merchant
pnpm.cmd dev:courier
pnpm.cmd dev:worker
```

## Local setup — Linux/macOS

From the repository root:

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm check
```

Start one application per terminal:

```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:merchant
pnpm dev:courier
pnpm dev:worker
```

`pnpm dev` can start all five app processes together, but separate terminals are
easier while the Expo QR/dev-server output is needed.

## Local addresses

| Service      | Address                               |
| ------------ | ------------------------------------- |
| API health   | `http://localhost:3000/api/v1/health` |
| Admin web    | `http://localhost:3001`               |
| Merchant web | `http://localhost:3002`               |
| Expo Metro   | `http://localhost:8081`               |
| PostgreSQL   | `localhost:5432`                      |
| Redis        | `localhost:6379`                      |

## Demo data

The seed is deterministic and safe to run repeatedly. Every demo account uses
the local `OTP_MOCK_CODE` (`123456` in `.env.example`) and synthetic data.

| Persona                   | Phone           | Public role/state   |
| ------------------------- | --------------- | ------------------- |
| Merchant owner            | `+201001000001` | `merchant_owner`    |
| Merchant manager          | `+201001000002` | `merchant_manager`  |
| Merchant staff            | `+201001000003` | `merchant_staff`    |
| Operations admin          | `+201001000004` | `operations_admin`  |
| Super admin               | `+201001000005` | `super_admin`       |
| Finance admin             | `+201001000006` | `finance_admin`     |
| Incomplete courier        | `+201001000011` | `incomplete`        |
| Pending courier           | `+201001000012` | `pending_review`    |
| Approved courier          | `+201001000013` | `approved`          |
| Changes-requested courier | `+201001000014` | `changes_requested` |

The seed also creates one merchant, owner/manager/staff memberships, one Giza
store with a PostGIS point, synthetic private courier documents, and five
disabled future flags.

## Commands

| Command            | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `pnpm check`       | Formatting, lint, type checks, tests, and all builds |
| `pnpm test`        | Run unit tests once                                  |
| `pnpm typecheck`   | Type-check all workspaces                            |
| `pnpm db:generate` | Generate the Prisma client                           |
| `pnpm db:migrate`  | Create/apply a development migration                 |
| `pnpm db:deploy`   | Apply committed migrations non-interactively         |
| `pnpm db:seed`     | Upsert deterministic demo data                       |
| `pnpm db:status`   | Report migration state                               |
| `pnpm infra:up`    | Start and health-check PostgreSQL and Redis          |
| `pnpm infra:down`  | Stop local infrastructure without deleting data      |

To remove local database and Redis data intentionally, run
`docker compose down --volumes`. This is destructive and is not part of normal
setup or teardown.

## Repository map

```text
apps/
  api/             NestJS Phase 1 REST API
  admin-web/       Next.js Arabic/RTL operations console
  merchant-web/    Next.js Arabic/RTL merchant workspace
  courier-mobile/  Expo Arabic/RTL courier onboarding
  worker/          BullMQ worker foundation
packages/
  config/          shared TypeScript configs and environment validation
  contracts/       domain constants and RBAC policy
  database/        generated Prisma client and connection factory
  localization/    Arabic-first message catalog and direction metadata
  observability/   structured logging, errors, and audit contract
  providers/       external-provider ports and local OTP adapter
  ui/              web design tokens and accessible primitives
  validation/      shared Zod schemas
infrastructure/
  database/        Prisma schema, migrations, and seed
  docker/          container notes (Compose is at the repository root)
  deployment/      provider-neutral deployment boundary
docs/
  architecture/    system and data architecture
  adr/             Architecture Decision Records
  api/             API conventions
  product/         implementation plan and source-spec pointer
```

## Documentation

- [Architecture overview](docs/architecture/README.md)
- [Data architecture](docs/architecture/data-model.md)
- [Phase 1 identity model](docs/architecture/identity-domain.md)
- [Authentication and sessions](docs/architecture/auth-sessions.md)
- [RBAC matrix](docs/architecture/rbac-matrix.md)
- [Courier verification workflow](docs/architecture/courier-verification.md)
- [Document security](docs/architecture/document-security.md)
- [Phase 1 data model](docs/architecture/phase-1-data-model.md)
- [API conventions](docs/api/conventions.md)
- [Phase 1 routes](docs/api/phase-1-routes.md)
- [Phase 0 implementation plan](docs/product/phase-0-plan.md)
- [Phase 1 implementation plan](docs/product/phase-1-plan.md)
- [Phase 1 completion report](docs/product/phase-1-completion.md)
- [Architecture decisions](docs/adr/README.md)
- [Product specification source](wasel_codex_product_spec.html)

## Security notes

`.env` is ignored and must never be committed. Values in `.env.example` are
local-only. Production mode does not construct the mock OTP provider. OTP HMAC
peppers and JWT secrets must come from a managed secret store. Courier files
are private and authenticated locally; production requires the documented
encrypted object-storage adapter and malware scanning. Logs redact phone, OTP,
authorization, cookie, token, and secret fields.
