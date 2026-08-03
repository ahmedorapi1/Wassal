# Phase 4 RBAC matrix

Platform guards establish the authenticated role. Merchant services then apply
membership and resource-ownership checks; RBAC alone never grants cross-tenant
access.

| Capability                        | Owner |    Manager | Staff | Courier | Support |     Operations | Finance | Super |
| --------------------------------- | ----: | ---------: | ----: | ------: | ------: | -------------: | ------: | ----: |
| View merchant/store               |     ✓ |          ✓ |     ✓ |         |         | via admin view |         |     ✓ |
| Edit merchant/store               |     ✓ |          ✓ |       |         |         |                |         |     ✓ |
| Manage merchant staff             |     ✓ | staff only |       |         |         |                |         |     ✓ |
| Edit own courier profile          |       |            |       |       ✓ |         |                |         |       |
| Upload own courier documents      |       |            |       |       ✓ |         |                |         |       |
| Review courier documents/accounts |       |            |       |         |         |              ✓ |         |     ✓ |
| Change user account status        |       |            |       |         |         |              ✓ |         |     ✓ |
| View Phase 1 audit history        |       |            |       |         |         |              ✓ |         |     ✓ |

Owner invariants and manager restrictions are enforced in the same transaction
as membership changes. Operations and super administrators can read a courier
document through the authenticated file endpoint; only the owning courier has
equivalent self-service access.

| Phase 2 capability                    | Owner | Manager | Staff | Courier | Support | Operations | Finance | Super |
| ------------------------------------- | ----: | ------: | ----: | ------: | ------: | ---------: | ------: | ----: |
| Create/view merchant customers        |     ✓ |       ✓ |     ✓ |         |         |            |         |       |
| Archive/restore customers             |     ✓ |       ✓ |       |         |         |            |         |       |
| Create/view quotes and orders         |     ✓ |       ✓ |     ✓ |         |         |            |         |       |
| Cancel merchant order                 |     ✓ |       ✓ |       |         |         |            |         |       |
| View all admin orders/timelines       |       |         |       |         |       ✓ |          ✓ |       ✓ |     ✓ |
| Admin-cancel eligible order           |       |         |       |         |         |          ✓ |         |     ✓ |
| View service zones/pricing            |       |         |       |         |       ✓ |          ✓ |       ✓ |     ✓ |
| Create/version/activate zones/pricing |       |         |       |         |         |            |         |     ✓ |
| Discover/accept courier order         |       |         |       |         |         |            |         |       |

| Phase 3 capability                     | Owner | Manager | Staff | Courier | Support | Operations | Finance | Super |
| -------------------------------------- | ----: | ------: | ----: | ------: | ------: | ---------: | ------: | ----: |
| View own-zone privacy-safe marketplace |       |         |       |       ✓ |         |            |         |       |
| Atomically accept eligible order       |       |         |       |       ✓ |         |            |         |       |
| View/update own assigned order         |       |         |       |       ✓ |         |            |         |       |
| View own account and settlements       |       |         |       |       ✓ |         |            |         |       |
| View courier accounts/settlements      |       |         |       |         |         |            |       ✓ |     ✓ |
| Close ended settlements                |       |         |       |         |         |            |       ✓ |     ✓ |
| Record an external payment             |       |         |       |         |         |            |       ✓ |     ✓ |
| Change versioned financial settings    |       |         |       |         |         |            |         |     ✓ |
| Create adjustment/waiver               |       |         |       |         |         |            |         |     ✓ |
| Reverse payment/ledger correction      |       |         |       |         |         |            |         |     ✓ |
| Export settlement CSV                  |       |         |       |         |         |            |       ✓ |     ✓ |

Merchant services always add `merchantId` ownership predicates. Courier
marketplace/account services derive the courier from the authenticated user and
never accept an arbitrary courier ID. Admin list phones are masked; authorized
detail screens can inspect historical evidence.

Finance administrators can read courier accounts, close settlements, record
payments that occurred externally, and export. They cannot change the global
commission, waive, adjust, or reverse. Operations administrators can manage
delivery operations and verification but cannot read/mutate Phase 3 financial
accounts. Super administrators hold the explicit elevated correction/settings
permissions.

| Phase 4 capability                        | Owner | Manager | Staff | Courier | Support | Operations | Finance | Super |
| ----------------------------------------- | ----: | ------: | ----: | ------: | ------: | ---------: | ------: | ----: |
| Create/read own delivery dispute          |     ✓ |       ✓ |       |         |         |            |         |       |
| Respond to assigned delivery dispute      |       |         |       |       ✓ |         |            |         |       |
| Read delivery-dispute queue               |       |         |       |         |       ✓ |          ✓ |         |     ✓ |
| Resolve delivery dispute                  |       |         |       |         |         |          ✓ |         |     ✓ |
| Confirm own-merchant returned order       |     ✓ |       ✓ |       |         |         |            |         |       |
| Override stale return                     |       |         |       |         |         |          ✓ |         |     ✓ |
| Submit/read/cancel own payment proof      |       |         |       |       ✓ |         |            |         |       |
| Read private payment-proof file           |       |         |       |       ✓ |         |            |       ✓ |     ✓ |
| Review/approve/reject payment proof       |       |         |       |         |         |            |       ✓ |     ✓ |
| Read operational settings/history         |       |         |       |         |       ✓ |          ✓ |       ✓ |     ✓ |
| Create operational-settings version       |       |         |       |         |         |            |         |     ✓ |
| Approve/suspend pilot merchant or courier |       |         |       |         |         |          ✓ |         |     ✓ |
| Reset a pilot password                    |       |         |       |         |         |          ✓ |         |     ✓ |

Proof files add an ownership check after the permission guard: a courier can
only stream their own proof. Operations cannot read or approve payment proofs.
Finance cannot resolve disputes or override returns. Merchant staff cannot
create disputes or confirm returns. Notifications are always filtered by
`recipientUserId`; server-derived real-time rooms never replace REST
authorization.
