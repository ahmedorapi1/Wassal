# WASSAL Merchant Branch and First-Time Onboarding Completion Report

Date: 2026-07-29  
Environment: local development pilot

## Outcome

The Merchant Web branch workflow is visible and usable on the real
`المتجر والفريق` page. A feature-flagged phone/password merchant registration
flow now creates a pending merchant owner, business, and first mapped branch.
Operations admins can inspect the submitted data, approve it, reject it with a
reason, or request changes with a reason. Pending merchants cannot use order
operations until approval.

## Root-cause diagnosis

- The seeded owner session was correct:
  - API role: `merchant_owner`
  - Merchant membership role: `OWNER`
  - User status: `ACTIVE`
  - Merchant status: `ACTIVE`
- `BranchCreationForm` was imported by `merchant-app.tsx` and rendered inside
  the visible `Settings` view selected by `المتجر والفريق`.
- The role condition correctly accepted `OWNER` and `MANAGER` and rejected
  `STAFF`.
- The missing button in the previously running browser was caused by a stale
  Merchant Web process. The process had started before the build containing the
  branch component and continued serving the old build.
- A second local startup risk was found: building the two Next.js applications
  without explicitly supplying `NEXT_PUBLIC_API_URL` embeds the fallback API
  address on port 3000. The verified build was rebuilt with
  `NEXT_PUBLIC_API_URL=http://localhost:3100/api/v1`.
- No hydration or runtime exception remained after rebuilding and restarting
  the current applications.
- The final approved-merchant order check exposed an initial quote countdown
  race: the UI initialized the countdown at zero and waited for a later React
  effect even though the API had already returned a valid
  `expiresInSeconds=900`. The quote itself was active and correctly persisted
  with a 15-minute TTL. Merchant Web now initializes the countdown directly
  from the server response, while the existing interval continues to reconcile
  against `expiresAt`.

## Visible add-branch workflow

- A prominent `إضافة فرع جديد` button is displayed for merchant owners and
  managers.
- The button is absent for merchant staff.
- The dedicated branch form collects:
  - branch name and phone;
  - governorate, city, area, street, and detailed address;
  - map location;
  - current-device location;
  - Google Maps link;
  - advanced manual coordinates.
- The existing freely navigable OpenStreetMap picker is reused. It supports
  pan, zoom, point selection, a movable marker, reset, and explicit point
  confirmation.
- Branch submission remains disabled until the point is confirmed and the API
  reports that it is inside an active pickup service zone.
- `POST /api/v1/merchants/current/stores` remains the creation endpoint.
- The server independently revalidates the pickup point, so bypassing the
  browser check cannot create an out-of-zone branch.
- The branch list is reloaded after creation. Because the new-order form uses
  the same current store state, the new branch becomes a pickup option
  immediately.

## First-time merchant onboarding

### Public pilot endpoints

- `GET /api/v1/auth/merchant-registration/config`
- `POST /api/v1/auth/merchant-registration/location/validate`
- `POST /api/v1/auth/merchant-registration/location/resolve-maps-link`
- `POST /api/v1/auth/merchant-registration`

The old generic pilot endpoint no longer accepts incomplete merchant
registrations; merchant applicants must use the complete first-branch flow.

### Feature flag and security controls

- `MERCHANT_PILOT_REGISTRATION_ENABLED` defaults to `false`.
- Local `.env` explicitly enables it for this pilot.
- `.env.example` keeps it disabled.
- Registration is rate-limited by IP and normalized phone.
- Public location/link calls are independently rate-limited.
- Passwords require at least 10 characters, an uppercase letter, a lowercase
  letter, and a number.
- Owner, business-contact, and branch phones use Egyptian phone normalization.
- Duplicate owner phones return a safe conflict response.
- The first branch is checked against an active pickup service zone before any
  account records are created.
- User, merchant, membership, store, PostGIS point, and audit record are
  created atomically.
- Registration and every administrative status decision create immutable audit
  records.

### Pending and approval behavior

- A new owner user is `PENDING`.
- A new merchant is `PENDING`.
- The first branch is saved with its confirmed PostGIS point.
- Pending users may authenticate only to see the pending-review screen.
- Order/customer operations require an active merchant context and remain
  unavailable while pending.
- Admin actions are:
  - `approve`;
  - `request-changes` with a reason;
  - `reject` with a reason;
  - existing suspension/reactivation actions.
- `request-changes` sets the merchant to `CHANGES_REQUESTED`, keeps the owner
  pending, and exposes the review note on the merchant pending screen.
- Approval activates both the merchant and its owner. The merchant can then log
  in and access the order-creation workflow.

## Database migration

Migration:

`20260729023000_merchant_pilot_registration`

It adds:

- `MerchantStatus.CHANGES_REQUESTED`;
- merchant business category, contact phone/email, review notes, and review
  timestamp;
- structured store governorate, street, and address-details fields.

The migration was applied successfully and the deterministic seed was rerun.

## Automated verification

- Focused configuration, Merchant Web, Admin Web, and map resolver tests:
  - 10 files passed;
  - 60 tests passed.
- Merchant registration integration suite:
  - 2 tests passed;
  - creates and verifies real PostGIS coordinates;
  - verifies duplicate-phone protection;
  - verifies pending operational isolation;
  - verifies request-changes and approval;
  - verifies post-approval order access.
- Phase 1 API regression suite:
  - 4 tests passed.
- ESLint passed for all files changed by this task.
- TypeScript checks passed for API, Merchant Web, Admin Web, and configuration.
- Production builds passed for API, Merchant Web, and Admin Web.
- The final Merchant Web source regression test passed again after the quote
  countdown correction (1 file, 3 tests).
- A later attempt to run the entire monorepo suite against the already-used
  demo database was not treated as a clean regression run: an immutable Phase
  4 fixture had already been finalized by the previously running background
  worker, while that integration test expects a pristine seeded fixture.
  Re-running that unrelated stateful suite requires an isolated/fresh test
  database. No Phase 4 production code was changed for this onboarding task.

## Actual browser verification

Verification used the locally running production builds.

1. Logged in as seeded owner `01001000001`.
2. Opened `المتجر والفريق`.
3. Confirmed the prominent `إضافة فرع جديد` button was visible.
4. Opened the form and confirmed all requested address and location controls.
5. Opened the real map picker, used its zoom control, and confirmed an active
   Damietta service-zone point.
6. Created `فرع تحقق المتصفح`.
7. Confirmed the Arabic success message and immediate appearance in the branch
   list.
8. Opened `طلب توصيل جديد` and confirmed
   `فرع تحقق المتصفح · وسط دمياط` appeared in the pickup selector.
9. Logged in as seeded staff `01001000003` and confirmed the add-branch button
   was absent.
10. Opened `إنشاء حساب تاجر جديد`.
11. Created pilot account `01019999123` with business
    `متجر تحقق التسجيل` and one confirmed mapped branch.
12. Confirmed the submission and authenticated pending-review screens both
    blocked order access.
13. Logged into Admin Web as the seeded operations admin.
14. Opened the merchant registration and verified owner, business, branch,
    address, and coordinate details.
15. Approved the merchant and confirmed the status became `ACTIVE`.
16. Logged in again as the approved pilot merchant and confirmed the first
    branch appeared in the pickup selector and the order-creation screen was
    available.
17. Selected the first branch, chose and confirmed the customer point on the
    real map, calculated a 15-minute quote, and created order
    `WSL-260729-6EE4CACC52` successfully. The resulting screen showed
    `تم إنشاء الطلب` and `جارٍ البحث عن مندوب`.

The integration suite separately exercised the request-changes decision and
its reason before approval.

## Running local applications

- API: `http://localhost:3100`
- Merchant Web: `http://localhost:3002`
- Admin Web: `http://localhost:3001`
- Registration flag endpoint:
  `http://localhost:3100/api/v1/auth/merchant-registration/config`

Verified listener processes:

- API PID: `25768`
- Merchant Web PID: `25504`
- Admin Web PID: `26720`

PostgreSQL/PostGIS and Redis Docker containers were healthy during migration,
seed, integration testing, and browser verification.

## Files changed for this task

- `.env.example`
- local ignored `.env`
- `packages/config/src/env.ts`
- `packages/config/src/env.test.ts`
- `infrastructure/database/prisma/schema.prisma`
- `infrastructure/database/prisma/seed.ts`
- `infrastructure/database/prisma/migrations/20260729023000_merchant_pilot_registration/migration.sql`
- `apps/api/src/location/location.controller.ts`
- `apps/api/src/location/location.service.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/merchant/merchant.controller.ts`
- `apps/api/src/merchant/merchant.service.ts`
- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/phase-one.e2e.test.ts`
- `apps/api/src/merchant-registration.e2e.test.ts`
- `apps/merchant-web/app/branch-creation-form.tsx`
- `apps/merchant-web/app/branch-creation-form.test.tsx`
- `apps/merchant-web/app/merchant-registration.tsx`
- `apps/merchant-web/app/merchant-registration.test.tsx`
- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/merchant-app.test.tsx`
- `apps/merchant-web/app/styles.css`
- `apps/admin-web/app/admin-app.tsx`
- `apps/admin-web/app/admin-app.test.tsx`
- `docs/merchant-branch-and-first-onboarding-report.md`

No Git commit was created.
