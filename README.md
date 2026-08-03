# SKKA / سِكّة

SKKA (سِكّة) is an Arabic-first, on-demand delivery platform for Egypt. كل طلب له سكة. Merchants
create delivery requests and independent motorcycle couriers accept, collect,
and deliver them. This repository contains the production foundation, Phase 1
identity/onboarding/verification, Phase 2 customer/order creation, and
Phase 3 marketplace/accounting and **Phase 4: authenticated real-time
operations, delivery disputes, confirmed returns, external payment-proof
review, structured address review, pilot password authentication, and
production foundations**.

## Phase 4 status

Included:

- pnpm/Turborepo TypeScript monorepo with NestJS, Next.js, Expo, and a BullMQ worker
- PostgreSQL 18 + PostGIS 3.6 and Redis 8 Docker services
- controlled pilot phone/password authentication, pending registration,
  lockout/reset/forced change, rotating refresh sessions, logout/revocation,
  and `/me` (development OTP remains only for earlier-phase compatibility)
- public RBAC roles plus merchant tenant and resource-ownership checks
- merchant profile, PostGIS stores, operating hours, and staff management
- courier profile, motorcycle, private/versioned documents, and review submission
- transactional administrator verification, user status, audit, and history
- connected Arabic-first/RTL merchant, courier, and admin interfaces
- real PostgreSQL/Redis integration tests and deterministic Phase 1 seeds
- merchant-scoped customers, normalized phones, archive lifecycle, and saved
  PostGIS addresses
- synthetic Damietta service zone with PostGIS containment and a deterministic
  local distance/duration provider
- database-driven, versioned EGP pricing with integer-minor-unit breakdowns
- expiring/idempotent quotes and transactional one-time order confirmation
- centralized early order state machine, immutable events, and concurrency-safe
  merchant/admin cancellation
- complete merchant order creation/list/detail UI and admin order/zone/pricing UI
- service-zone courier memberships and strict operational eligibility
- privacy-reduced courier marketplace cards before assignment
- serializable, idempotent, row-locked first-courier-wins acceptance
- persisted five-minute courier-acceptance windows, one merchant-controlled
  retry, worker-enforced expiry, and late-accept rejection
- merchant owner/manager cancellation free through `AT_PICKUP`; cancellation
  from `PICKED_UP` converts to the existing confirmed-return flow while keeping
  the original delivery fee and creating no extra return fee
- full pickup, delivery, failed-delivery, return, and completion lifecycle
- typed immutable lifecycle events and resource-scoped audit evidence
- versioned 20% basis-point commission settings and quote/order snapshots
- append-only courier ledger with one commission entry per completed order
- Cairo-calendar weekly settlements, seven-day grace period, and overdue worker
- manually recorded external payments with oldest-first allocation
- super-admin adjustments, waivers, and linked reversals
- courier statement UI and role-aware admin finance/reconciliation workspace
- authenticated Socket.IO operational events with REST reconciliation and no
  courier location channel
- persisted, deduplicated in-app notification centers
- reviewed location/quote confirmation before order creation
- delivered state with a snapshotted 24-hour dispute deadline and delayed
  commission finalization
- merchant/courier/admin dispute workflow and merchant-confirmed return flow
- private courier payment-proof submission and transactional finance approval
- Arabic-first privacy/terms drafts and deployment/backup/operations runbooks
- production-only private S3-compatible storage validation and readiness checks
- shared SKKA / سِكّة branding assets and tokens across web and Expo

Not included: live tracking, background GPS, location upload, an online
availability switch, automated dispatch offers, payment gateways, in-app
wallets, automatic payouts/transfers, COD, delivery proof, ratings, scheduled
delivery, multi-stop, subscriptions, or surge. Navigation opens a stored
destination in an external maps application. Distance/duration are deterministic
offline estimates rather than road-network routing.

The merchant location picker uses attributed OpenStreetMap raster tiles without
a geocoding API. Textual street/area search stays disabled behind the reserved
`NEXT_PUBLIC_MAP_TEXT_SEARCH_ENABLED=false` flag until SKKA approves a
provider and its usage policy; the application does not silently call public
Nominatim, Google Geocoding, Places, Directions, or another paid map API.

## Prerequisites

- Node.js 24 LTS
- pnpm 11.16 or newer
- Docker Desktop (Windows/macOS) or Docker Engine with Compose (Linux)
- Git

The repository pins pnpm in `package.json`. If pnpm is not installed, enable it
with Corepack:

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
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

### Android courier prerequisite

Expo Go on a physical Android device cannot reach an API configured as
`localhost`. Set `EXPO_PUBLIC_API_URL` in the root `.env` to the development
computer's active LAN IPv4 address, keep port `3100`, and start Expo through the
root script so that the variable is passed to Metro:

```powershell
ipconfig
pnpm.cmd dev:courier
```

For example, a computer at `192.168.1.50` uses
`http://192.168.1.50:3100/api/v1`. The phone and computer must be on the same
network, the API must listen on `0.0.0.0`, and the Windows firewall must allow
the local development ports. The Android app fails fast instead of silently
using a loopback address; when possible it also derives the API host from
Metro's LAN bundle URL.

## Local addresses

| Service      | Address                               |
| ------------ | ------------------------------------- |
| API health   | `http://localhost:3100/api/v1/health` |
| Admin web    | `http://localhost:3001`               |
| Merchant web | `http://localhost:3002`               |
| Expo Metro   | `http://localhost:8081`               |
| PostgreSQL   | `localhost:5432`                      |
| Redis        | `localhost:6379`                      |

## Demo data

The seed is deterministic and safe to run repeatedly. It contains only
synthetic data. Phase 4 web/mobile demos use the passwords below. The
development-only mock OTP code remains `123456` for earlier-phase test
compatibility and is disabled in production.

| Persona                   | Phone           | Password          | Public role/state   |
| ------------------------- | --------------- | ----------------- | ------------------- |
| Merchant owner            | `+201001000001` | `MerchantDemo123` | `merchant_owner`    |
| Merchant manager          | `+201001000002` | `MerchantDemo123` | `merchant_manager`  |
| Merchant staff            | `+201001000003` | `MerchantDemo123` | `merchant_staff`    |
| Operations admin          | `+201001000004` | `AdminDemo123`    | `operations_admin`  |
| Super admin               | `+201001000005` | `AdminDemo123`    | `super_admin`       |
| Finance admin             | `+201001000006` | `AdminDemo123`    | `finance_admin`     |
| Incomplete courier        | `+201001000011` | `CourierDemo123`  | `incomplete`        |
| Pending courier           | `+201001000012` | `CourierDemo123`  | `pending_review`    |
| Approved courier          | `+201001000013` | `CourierDemo123`  | `approved`          |
| Changes-requested courier | `+201001000014` | `CourierDemo123`  | `changes_requested` |
| Approved courier 2        | `+201001000015` | `CourierDemo123`  | `approved`          |
| Approved courier 3        | `+201001000016` | `CourierDemo123`  | `approved`          |
| Suspended courier         | `+201001000017` | `CourierDemo123`  | `suspended`         |

The seed also creates one merchant, owner/manager/staff memberships, a synthetic
Damietta store, two service zones, multi-courier zone memberships, pricing and
financial-setting history, customers, saved addresses, safe marketplace orders,
an assigned order, completed and returned orders, synthetic private courier
documents, open/partially-paid/paid/overdue settlements, external payments,
adjustment/waiver examples, structured addresses, reviewed quotes, delivered
orders inside/past the dispute window, open/resolved disputes, failed/awaiting
return cases, notification history, pending/partial/rejected payment proofs,
operational settings, and five disabled future flags.

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
  api/             NestJS Phase 1–4 modular-monolith REST/realtime API
  admin-web/       Next.js Arabic/RTL operations console
  merchant-web/    Next.js Arabic/RTL merchant workspace
  courier-mobile/  Expo Arabic/RTL onboarding, marketplace, delivery, statement
  worker/          BullMQ timeout, settlement, finalization, reminder, retention jobs
packages/
  config/          shared TypeScript configs and environment validation
  contracts/       domain constants and RBAC policy
  database/        generated Prisma client and connection factory
  localization/    Arabic-first message catalog and direction metadata
  observability/   structured logging, errors, and audit contract
  providers/       provider ports plus local OTP, storage, and maps adapters
  ui/              shared SKKA tokens/assets and accessible primitives
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
- [Order cancellation and acceptance timeout report](docs/order-cancellation-and-acceptance-timeout-report.md)
- [Phase 1 data model](docs/architecture/phase-1-data-model.md)
- [API conventions](docs/api/conventions.md)
- [Phase 1 routes](docs/api/phase-1-routes.md)
- [Phase 2 routes](docs/api/phase-2-routes.md)
- [Phase 3 routes](docs/api/phase-3-routes.md)
- [Phase 2 order domain and state machine](docs/architecture/phase-2-order-domain.md)
- [Customer and address design](docs/architecture/customer-address-design.md)
- [Service zones and pricing](docs/architecture/service-zones-pricing.md)
- [Quote lifecycle](docs/architecture/quote-lifecycle.md)
- [Phase 2 database diagram](docs/architecture/phase-2-data-model.md)
- [Maps provider integration](docs/architecture/maps-provider.md)
- [Phase 3 marketplace and accounting](docs/architecture/phase-3-marketplace-accounting.md)
- [Phase 0 implementation plan](docs/product/phase-0-plan.md)
- [Phase 1 implementation plan](docs/product/phase-1-plan.md)
- [Phase 1 completion report](docs/product/phase-1-completion.md)
- [Phase 2 implementation plan](docs/product/phase-2-plan.md)
- [Phase 2 completion report](docs/product/phase-2-completion.md)
- [Phase 2 demo data](docs/product/phase-2-demo-data.md)
- [Phase 3 implementation report](docs/phase-3-implementation-report.md)
- [SKKA / سِكّة branding assets and tokens](docs/product/wassal-branding.md)
- [Architecture decisions](docs/adr/README.md)
- [Product specification source](wasel_codex_product_spec.html)

## Security notes

`.env` is ignored and must never be committed. Values in `.env.example` are
local-only. Production mode does not construct the mock OTP provider. OTP HMAC
peppers and JWT secrets must come from a managed secret store. Courier files
are private and authenticated locally; production requires the documented
encrypted object-storage adapter and malware scanning. Logs redact phone, OTP,
authorization, cookie, token, and secret fields.
