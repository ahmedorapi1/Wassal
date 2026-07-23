# Phase 1 RBAC matrix

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
