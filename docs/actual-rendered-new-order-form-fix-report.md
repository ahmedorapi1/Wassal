# Actual Rendered New Order Form Fix Report

Date: 2026-07-29

## Route and rendered component

The Merchant Web does not use a separate Next.js URL for order creation. The
exact route is `/` (`http://localhost:3002/`) and the navigation button changes
the local `MerchantApp` view to `new`.

The rendered tree is:

1. `apps/merchant-web/app/page.tsx` renders `MerchantApp`.
2. The `طلب توصيل جديد` button sets `view` to `new`.
3. `apps/merchant-web/app/merchant-app.tsx` renders
   `CanonicalNewOrder`.
4. `CanonicalNewOrder` is the `NewOrder` export from
   `apps/merchant-web/app/new-order.tsx`.

The visible component fixed and verified in this change is therefore
`NewOrder` in `apps/merchant-web/app/new-order.tsx`.

## Investigation and root cause

The exact source file that retained the previous duplicate implementation was
`apps/merchant-web/app/merchant-app.tsx`:

- `NewOrderLegacy` starts at line 1210 and is retained only by
  `void NewOrderLegacy`.
- exported `LegacyNewOrder` starts at line 2335 and has no in-repository
  consumer.
- those forms contain separate `customerName`/`customerPhone` and
  `contactName`/`contactPhone` inputs.

The currently selected source branch already imported the newer component, but
the Merchant process on port 3002 was an old development process and its
`.next/dev` output contained multiple stale chunks compiled from the legacy
forms. The prior report changed the new component without completing the
`عميل محفوظ` behavior and did not verify a clean rebuild of the process that
the browser was actually displaying. This is why the previous source report
did not match the visible page.

The separate `البريد الإلكتروني` field that remains around line 3033 of
`merchant-app.tsx` belongs to the customer-directory management form, not the
new-order workflow. It remains intentionally available there. There is no
email field, email state, email default, email validation, or email property in
the active new-order payload.

Two local runtime blockers were also identified during real verification:

- the stale API process did not reflect the current CORS setup;
- the first direct Next build, run from `apps/merchant-web`, used the
  `http://localhost:3000/api/v1` fallback because the monorepo-root `.env` was
  not injected.

The API was rebuilt/restarted from current source with the existing root
environment. Merchant Web was then rebuilt with
`NEXT_PUBLIC_API_URL=http://localhost:3100/api/v1` and restarted from a clean
`.next` output. No production configuration or credentials were introduced.

## Implementation

The active `NewOrder` component now keeps both customer modes:

- `عميل جديد` shows one editable `اسم العميل — إجباري` field and one editable
  `رقم الموبايل — إجباري` field.
- `عميل محفوظ` shows the saved-customer selector and populates the same single
  name and phone controls as read-only values.

`OrderFormInput`, validation, field focus, fingerprinting, localized API error
mapping, and tests now use `customerName` and `customerPhone`. Payload creation
derives one canonical pair:

```ts
const contactName = input.customerName.trim();
const contactPhone = normalizeEgyptianOrderPhone(input.customerPhone);
```

Both backend representations use that pair:

```ts
customer: { name: contactName, phone: contactPhone },
dropoff: { contactName, contactPhone }
```

The API quote-validation mapper now returns `customerName` and `customerPhone`
field keys with the same Arabic labels.

## Before and after rendered labels

The stale/legacy form shown before the fix contained:

- `اسم العميل`
- `رقم الموبايل`
- `البريد الإلكتروني`
- `اسم المستلم`
- `هاتف المستلم`

The clean production build was opened through the actual sidebar action. The
live DOM counts were:

| Mode       | Saved selector | اسم العميل | رقم الموبايل | البريد الإلكتروني | اسم المستلم | هاتف المستلم |
| ---------- | -------------: | ---------: | -----------: | ----------------: | ----------: | -----------: |
| عميل جديد  |              0 |          1 |            1 |                 0 |           0 |            0 |
| عميل محفوظ |              1 |          1 |            1 |                 0 |           0 |            0 |

The saved mode visibly populated the one name and phone source. The new mode
rendered them empty and editable.

## Quote and order verification

A real browser journey was completed against the running local applications:

- merchant: `http://localhost:3002/` returned HTTP 200;
- API health: `http://localhost:3100/api/v1/health` returned HTTP 200;
- login: seeded merchant owner;
- location: `31.4321, 31.8273`, reviewed through the actual map dialog;
- quote: 2.49 km, approximately 7 minutes, EGP 22.47;
- order: `WSL-260729-5EFE198B21`;
- persisted status: `SEARCHING_COURIER`.

The persisted order was read back through the API. Its customer snapshot and
drop-off contact were identical:

```text
customer.name        = مستلم موحد محدث
dropoff.contactName  = مستلم موحد محدث
customer.phone       = +201534357376
dropoff.contactPhone = +201534357376
```

This was an actual in-app-browser verification, not an inferred source-only
result.

## Automated verification

- Focused React Testing Library/API tests: 4 files, 10 tests passed.
- Merchant Web TypeScript: passed.
- API TypeScript: passed.
- Focused ESLint with zero warnings: passed.
- Focused Prettier check: passed.
- Merchant Web optimized production build: passed.
- API `tsup` build: passed.
- Browser DOM verification: passed for both customer modes.
- Real quote/order creation and API read-back: passed.

The full repository Vitest command was also attempted. It timed out after
302 seconds and is not reported as passing. Before timeout it reported failures
in existing Phase 3/4 integration suites
(`phase-three.e2e.test.ts`, `phase-four.e2e.test.ts`,
`phase-four-jobs.test.ts`, and `service-zones.e2e.test.ts`). The focused form,
request-mapping, and exception-mapping tests all passed independently.

## Files changed

Merchant Web:

- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/new-order.tsx`
- `apps/merchant-web/app/order-form.ts`
- `apps/merchant-web/app/new-order.test.tsx`
- `apps/merchant-web/app/order-form.test.ts`
- `apps/merchant-web/app/styles.css`
- `apps/merchant-web/package.json`

API:

- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/infrastructure/request.test.ts`
- `apps/api/src/infrastructure/http-exception.filter.test.ts`

Workspace/documentation:

- `pnpm-lock.yaml`
- `docs/actual-rendered-new-order-form-fix-report.md`

No database model or migration was changed.
