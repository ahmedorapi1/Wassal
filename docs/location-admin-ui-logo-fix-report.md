# WASSAL Location, Admin UI, and Logo Corrective Report

Date: 2026-07-28  
Scope: focused corrective update after Phase 4; no new product phase

## 1. Stale distance and price root cause

The distance provider and pricing formula were not reusing a cached distance.
The stale result originated earlier in the merchant data path:

1. The order form visually allowed latitude and longitude to change while a
   previously selected saved-address ID remained authoritative.
2. When that ID was present, the quote payload sent only `{ addressId }`.
3. The API correctly resolved that saved address, so the edited coordinates
   displayed by the client never reached the maps provider.
4. The former recalculation action also recalculated from the existing quote's
   saved drop-off snapshot/address identity. It therefore could only reproduce
   the old route.

The deterministic local maps provider and `calculatePrice` behaved correctly
when they received different coordinates.

## 2. Old versus new quote behavior

Previously, visible coordinate edits could coexist with an old saved-address
selection and an old quote. The merchant could see a changed form but still
submit the saved address or reuse the prior quote.

Now:

- Saved-address, map, device, Google-link, and manual-coordinate selections are
  mutually authoritative.
- Selecting a temporary point clears the saved-address ID.
- Every pricing-relevant edit invalidates the displayed quote, distance,
  duration, and price.
- A deterministic client fingerprint includes store, customer/address identity,
  delivery coordinates, category, package size, weight, count, fragile,
  thermal-bag, and declared-value inputs.
- The create-order action remains disabled unless the current fingerprint
  exactly matches the fingerprint stored with the quote.
- Quote creation sends the current point and creates a new immutable quote.
- Order confirmation still requires the exact quote ID and quote version.
- The API remains authoritative: it validates coordinates and service-zone
  coverage, calculates the route and price, and persists immutable snapshots.
- Development quote review shows the exact pickup/drop-off points and pricing
  version used.

## 3. Location picker implementation

The merchant new-order flow now has an Arabic-first `موقع العميل` section with:

- Select on map.
- Use the merchant device's current location once.
- Paste a Google Maps link.
- Collapsed advanced manual coordinates.
- A confirmed-location summary, service-zone name, open-map link, change, and
  clear actions.

The picker is a lightweight dependency-free OpenStreetMap tile canvas. Provider
configuration, Web Mercator projection, tile layout, and attribution are
isolated in `apps/merchant-web/app/open-map.ts`. Attribution is visible.
Clicking/tapping changes the marker, arrow controls provide fine adjustment,
and confirm/cancel/reset are explicit. The public OSM community tile endpoint
is suitable for this controlled pilot only; production traffic needs an
approved commercial or self-hosted tile policy.

## 4. Current-location behavior

Geolocation permission is requested only after the user presses the action.
The implementation uses one `getCurrentPosition` request, never
`watchPosition`. The point is reviewed on the map and must be confirmed. Clear
Arabic errors cover denied permission, unavailable location, timeout, and
points outside the active service zone. No movement history is stored.

## 5. Google Maps link support

Supported explicit-coordinate formats on approved HTTPS Google hosts:

- `/maps/@latitude,longitude,...`
- `?q=latitude,longitude`
- `?query=latitude,longitude`
- `?ll=latitude,longitude`
- data paths containing `!3dlatitude!4dlongitude`

`maps.app.goo.gl` short links are resolved by
`POST /api/v1/location/resolve-maps-link`.

## 6. Short-link security design

The endpoint is restricted to authenticated merchant owner/manager/staff
roles. It applies a Redis limit of 10 attempts per user per minute and:

- accepts HTTPS only and a maximum URL length of 1,000 characters;
- allowlists only supported Google/Google Maps hosts;
- follows at most three redirects;
- rejects redirects outside the allowlist;
- resolves all DNS answers and rejects loopback, RFC1918/private, link-local,
  metadata, multicast, and non-public IPv4/IPv6 addresses;
- pins the validated address for the HTTPS request to reduce DNS-rebinding risk;
- uses a 3.5-second timeout and a 16 KiB maximum response;
- does not execute scripts or return arbitrary page content;
- extracts only coordinates and a normalized safe URL;
- validates the final point against active PostGIS delivery zones.

Security tests cover malformed and HTTP URLs, unsupported hosts, private DNS,
loopback/cloud metadata ranges, cross-domain redirects, redirect limits, valid
long/short links, and links without coordinates.

## 7. Admin raw JSON inventory and replacement

The frontend search found eight primary object dumps:

1. Customer snapshot.
2. Pickup snapshot.
3. Delivery snapshot.
4. Package snapshot.
5. Route snapshot.
6. Pricing snapshot.
7. Financial-setting version history.
8. Courier-account audit history.

All eight were replaced. The service-zone GeoJSON textarea was also removed and
replaced with labeled boundary-coordinate fields. No ordinary Admin screen now
contains a `<pre>` object dump or pretty-printed `JSON.stringify` output.

No technical JSON view was retained because every current use had a suitable
readable representation. JSON serialization remains only for normal HTTP
request bodies and deterministic internal fingerprints.

## 8. Admin order-detail redesign

Order detail now provides:

- status, merchant/store, customer, courier, service zone, timestamps, version,
  distance, duration, and total summary cards;
- readable customer, pickup, delivery, package, and route fields;
- location-source labels and safe open-map actions;
- Cairo-time formatting and EGP formatting;
- readable price components;
- commission and estimated courier net only for finance/super-admin roles;
- dispute, failure, return, event, and audit sections;
- human event/action labels, actor, transition, notes, and timestamps.

The order list includes readable pickup/delivery, customer, distance, courier,
status, dispute/return indicators, fee, and open action. API list/detail queries
now include the courier and dispute summary required by the UI.

## 9. Pricing and finance UI redesign

Pricing rules use labeled, unit-aware inputs for geography, zone, vehicle,
base/minimum/distance fees, included/maximum distance, package surcharges,
three repeatable weight bands, fragile/thermal/waiting/return fees, commission,
tax, priority, and effective time. Rule cards expose readable version, scope,
dates, status, details, and weight bands.

Finance setting history and account audit history are readable rows rather than
raw JSON. Existing ledger, settlement, payment-proof, adjustment, waiver, and
reversal screens remain labeled table/form views.

## 10. Logo root cause and correction

The repository source asset is `D:\wasel\logo.png` (352 × 310 pixels). Its
visible alpha bounds are approximately x=40..307 and y=49..253, leaving nearly
symmetric transparent padding. The image itself was not the cause.

The shift came from directional/header layout and missing explicit centering:
web login images did not have centered container/margin rules, and the Courier
header used a reversed horizontal row around a small mark.

The original file was not cropped or redesigned. Web surfaces now use centered
flex/container layout, `object-fit: contain`, and centered `object-position`.
Expo uses centered containers and `resizeMode="contain"` without directional
logo offsets. The exact root asset is used by:

- Merchant login and navigation.
- Merchant privacy and terms pages.
- Admin login and navigation.
- Courier login/onboarding header.
- Courier operational header.
- Expo splash configuration.

## 11. Tests added or expanded

- Google Maps short-link resolver and SSRF/range tests.
- OSM projection/tile/Google-link helper tests.
- Quote fingerprint and location-A/location-B invalidation tests.
- Admin readable-order, readable-pricing, no-raw-JSON, and logo-layout tests.
- Merchant and Courier logo/accessibility/layout tests.
- Phase 2 E2E coverage for merchant-only location endpoints.
- Phase 2 E2E coverage for one saved point and two temporary map points,
  exact deterministic route/price results, no address overwrite, and immutable
  order snapshot selection.

## 12. Exact three-location results

Pickup: 31.417540, 31.814440. Package: small, 750 g, no fragile or thermal
surcharge. Active local rule: EGP 15.00 base, 1 km included, EGP 5.00/km.

| Location         | Coordinates          | Distance | Duration |     Price |
| ---------------- | -------------------- | -------: | -------: | --------: |
| A, saved address | 31.432100, 31.827300 |  2,494 m |    374 s | EGP 22.47 |
| B, temporary map | 31.440000, 31.780000 |  5,059 m |    759 s | EGP 35.30 |
| C, temporary map | 31.500000, 31.720000 | 15,767 m |  2,365 s | EGP 88.84 |

The order created in the test contains location C and
`locationSource: MAP_PICKER` in its immutable drop-off snapshot.

## 13. Verification results

- Prettier on changed files: passed.
- ESLint on application/package/infrastructure source: passed.
- Monorepo type check: 13/13 packages passed.
- Focused unit/render/security suite: 30/30 passed.
- Location/Phase 2 integration and E2E suite: 18/18 passed.
- Full Vitest run: 165/167 assertions passed. Two existing Phase 4 stateful
  tests fail when run against the long-lived demo database because their seed
  upserts do not reset previously transitioned fixed-ID orders. This corrective
  update did not change those Phase 4 workflows.
- Prisma schema validation: passed.
- API production build: passed.
- Merchant Next.js production build: passed, including `/`, `/privacy`, and
  `/terms`.
- Admin Next.js production build: passed.
- Courier Expo Android export: passed; Metro bundled `..\..\logo.png`.
- PostGIS and Redis Docker containers: healthy.
- API health, Admin root, and Merchant root: HTTP 200.
- Source/render assertions confirm centered contain styles and accessible logo
  labels. The in-app browser webview could not attach, so a fresh automated
  screenshot comparison was not available in this run.
- No schema change or migration was required.

## 14. Remaining limitations

- The local maps provider estimates straight-line distance with a stable urban
  road factor; it is not live routing, directions, or traffic.
- Public OSM community tiles require a different hosting/provider agreement at
  larger production volume.
- Short Google links without coordinates in their final safe redirect URL
  cannot be resolved without geocoding and are rejected.
- Browser geolocation accuracy depends on the merchant device and permission.
- Final multi-device visual acceptance should still be repeated on the pilot
  device matrix because the in-app browser webview did not attach in this run.
- The two Phase 4 fixed-ID test fixtures should eventually reset state per test
  or use transaction-isolated unique fixtures; that is outside this focused
  corrective scope.

## 15. Exact files changed for this correction

### API and shared validation

- `apps/api/src/app.module.ts`
- `apps/api/src/admin/phase-two-admin.service.ts`
- `apps/api/src/location/location.controller.ts`
- `apps/api/src/location/location.service.ts`
- `apps/api/src/location/maps-link-resolver.ts`
- `apps/api/src/location/maps-link-resolver.test.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/phase-two.e2e.test.ts`
- `packages/validation/package.json`
- `packages/validation/src/google-maps.ts`
- `packages/validation/src/phase-two.ts`
- `packages/validation/src/phase-four.ts`

### Merchant

- `apps/merchant-web/package.json`
- `apps/merchant-web/next.config.ts`
- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/merchant-app.test.tsx`
- `apps/merchant-web/app/map-picker.tsx`
- `apps/merchant-web/app/open-map.ts`
- `apps/merchant-web/app/open-map.test.ts`
- `apps/merchant-web/app/quote-input.ts`
- `apps/merchant-web/app/quote-input.test.ts`
- `apps/merchant-web/app/privacy/page.tsx`
- `apps/merchant-web/app/terms/page.tsx`
- `apps/merchant-web/app/styles.css`

### Admin

- `apps/admin-web/app/admin-app.tsx`
- `apps/admin-web/app/admin-app.test.tsx`
- `apps/admin-web/app/phase-three-finance.tsx`
- `apps/admin-web/app/styles.css`

### Courier and workspace

- `apps/courier-mobile/App.tsx`
- `apps/courier-mobile/operational-app.tsx`
- `apps/courier-mobile/app.json`
- `apps/courier-mobile/logo-layout.test.ts`
- `pnpm-lock.yaml`
- `docs/location-admin-ui-logo-fix-report.md`

## 16. MVP readiness

- This requested corrective specification: **100% implemented**.
- Broader pilot MVP implementation/readiness: **96% (unchanged)**.

The broader percentage remains unchanged because the remaining work is external
public-launch validation and operations: legal approval, production
infrastructure, real public authentication, signed-device acceptance, and
restore/security exercises. This correction removes known pilot UI/location
defects without claiming those external launch requirements are complete.

## Final scope confirmation

- No paid map, geocoding, routing, or Google Directions API was added.
- No live courier tracking, background GPS, or continuous device location was
  added.
- No payment gateway, SMS, WhatsApp, or customer-account functionality was
  added.
- No Phase 5 or other broad product phase was started.
