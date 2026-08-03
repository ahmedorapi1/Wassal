# Phase 2 demo data

All data is synthetic. Every account uses the development mock OTP
`OTP_MOCK_CODE` (`123456` in `.env.example`).

| Persona                   | Phone           | Purpose                                                                     |
| ------------------------- | --------------- | --------------------------------------------------------------------------- |
| Merchant owner            | `+201001000001` | Full merchant customers, quotes, orders, cancellation                       |
| Merchant manager          | `+201001000002` | Create/view/cancel orders and manage ordinary merchant data                 |
| Merchant staff            | `+201001000003` | Create/view customers and orders; cannot archive customers or cancel orders |
| Operations admin          | `+201001000004` | Inspect/cancel orders and perform courier operations                        |
| Super admin               | `+201001000005` | Manage service zones and pricing versions                                   |
| Finance admin             | `+201001000006` | Read pricing breakdowns; cannot manipulate order state                      |
| Incomplete courier        | `+201001000011` | Continue onboarding                                                         |
| Pending courier           | `+201001000012` | Review-state demo                                                           |
| Approved courier          | `+201001000013` | Phase 2 no-availability/no-offers placeholder                               |
| Changes-requested courier | `+201001000014` | Document replacement workflow                                               |

Seeded Phase 2 records include:

- synthetic Damietta merchant store and active service-zone multipolygon;
- historical and active EGP motorcycle pricing versions;
- two merchant customers and saved PostGIS drop-off addresses;
- active and expired quotes;
- draft, quoted, searching-for-courier, and cancelled orders;
- immutable early-lifecycle events.

Run `pnpm.cmd db:seed` repeatedly; stable IDs and upserts make the operation
idempotent. The seed creates no dispatch offer, courier assignment, tracking
point, wallet movement, payment, COD, settlement, or payout.
