# WASSAL location picker navigation and links fix report

Date: 2026-07-28  
Scope: focused merchant customer-location fix only

## Outcome

The merchant can now pan and zoom the map independently from the selected
marker, click/tap any visible point, drag the marker, and retain its exact
coordinates while the viewport changes. Service-zone eligibility is evaluated
after confirmation: an outside point remains selected and visible, while quote
and order creation are disabled.

Google Maps links now return one of two explicit outcomes:

- `COORDINATES_FOUND`: exact coordinates were extracted and the marker is
  centered on them for review.
- `MANUAL_SELECTION_REQUIRED`: the Google reference is valid, but exact
  coordinates were not safely extractable. The original URL is retained, the
  map opens at the best available fallback point, and the merchant sees:
  `تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.`

No paid maps, geocoding, places, or directions API was added.

## Root causes

### Failed Google Maps links

1. The shared extractor accepted only three long Google hostnames and required
   visible Egypt coordinates. Valid place/search/place-ID references were
   indistinguishable from an unsupported URL.
2. Encoded query coordinates such as `?q=31.4321%2C31.8273` were matched
   against the encoded `href`, so they could be missed.
3. The API accepted a no-coordinate path only when it was a short link, then
   threw a generic error if the final safe URL still had no visible
   coordinates.
4. The address validators rejected a retained Google place reference unless
   that same URL contained coordinates, which made the required manual fallback
   impossible to persist.
5. Live verification found an additional Node 24 compatibility defect:
   `https.request` can invoke a custom pinned lookup with `all: true`, but the
   resolver returned a single address rather than an address array. The request
   failed with `Invalid IP address: undefined`. The pinned lookup now supports
   both callback modes without weakening DNS pinning or SSRF protection.

### Restricted map navigation

The previous map was a fixed zoom-14 tile canvas. It had no viewport zoom state,
no drag/pan gesture, and no projection from marker coordinates back to canvas
pixels. Marker placement used approximate percentage multipliers and the only
adjustment was a four-direction coordinate nudge. It therefore felt locked to
the initial store/customer point.

### Outside-zone selection

The merchant client threw as soon as `/location/validate` returned
`supported: false`. Because the draft was updated only after a successful
inside-zone response, an outside marker could not remain confirmed or visible.

## Supported Google Maps formats

- Long HTTPS Google Maps URLs with explicit coordinates.
- `https://maps.app.goo.gl/...` short links.
- `/maps/place/...` references.
- `/maps/search/...` references.
- `?q=latitude,longitude`, including URL-encoded commas.
- `?query=latitude,longitude`, including URL-encoded commas.
- `/maps/@latitude,longitude`.
- `!3dlatitude!4dlongitude`.
- Text search, place-name, `query_place_id`, `place_id`, and `cid` references
  without directly visible coordinates.

The resolver still permits only approved HTTPS Google Maps hosts, rejects
credentials/custom ports, checks every DNS answer for a public address, pins
the selected public address, limits redirects to three, caps the response at
16 KiB, and applies a 3.5-second timeout. Redirects outside the allowlist remain
blocked.

## User-facing link errors

The API maps internal resolver classifications to safe Arabic messages for:

- unsupported links;
- links that do not identify a place or location;
- short-link timeouts;
- blocked/unsafe redirects;
- Google/network failures.

The merchant also maps browser-level `Failed to fetch`/network failures to a
clear Arabic network message and does not display raw socket or resolver
details.

## Map behavior

- Viewport center and marker coordinates are independent.
- Pointer dragging pans in every direction with no store-radius clamp.
- Mouse click or touch tap moves the marker to the projected map point.
- The marker itself is draggable.
- Wheel/trackpad and explicit `+`/`−` controls zoom from level 5 to 19.
- Zooming around a cursor anchor preserves the geographic point under that
  anchor.
- Marker coordinates remain unchanged during pan and zoom.
- A changed `initialPoint` is ignored after the first user interaction, avoiding
  unexpected recentering.
- Reset view, store location, device location, selected customer location,
  clear, confirm, cancel, and external preview controls are present.
- The initial point follows the existing caller precedence: last/current
  customer point, extracted link/device point, then the active store fallback.

Text search remains visibly disabled behind the reserved
`NEXT_PUBLIC_MAP_TEXT_SEARCH_ENABLED=false` flag. There is no approved geocoder
or usage policy, so WASSAL does not silently call public Nominatim or another
geocoding service.

## Service-zone and quote behavior

- `INSIDE`: the selected point stays visible, a green message is shown, and
  quote calculation is enabled.
- `OUTSIDE`: the selected point stays visible, the exact warning is shown, and
  quote/order creation is disabled:
  `الموقع خارج نطاق التوصيل الحالي. يمكنك تغيير الموقع أو طلب توسيع نطاق الخدمة من الإدارة.`
- `UNVALIDATED`: quote calculation remains disabled.

Confirming a different marker clears any address ID conflict, old quote,
distance, duration, price, and quote fingerprint. The exact selected
latitude/longitude is copied unchanged into the temporary drop-off payload. The
server's immutable quote fingerprint and quote/version checks were not weakened.

## Manual verification results

Environment:

- PostGIS container: healthy.
- Redis container: healthy.
- API health: `http://localhost:3100/api/v1/health` returned HTTP 200.
- Final merchant production bundle: `http://localhost:3002` returned HTTP 200.
- The built merchant JavaScript contains
  `http://localhost:3100/api/v1`.

All quote measurements below came from the running API, active seeded Damietta
store, active PostGIS zone, and active deterministic pricing rule.

| Case           | Selected coordinates   | Zone result                     |      Distance |      Duration |      Price | Merchant message                                                                           |
| -------------- | ---------------------- | ------------------------------- | ------------: | ------------: | ---------: | ------------------------------------------------------------------------------------------ |
| Near store     | `31.432100, 31.827300` | Inside, `منطقة دمياط التجريبية` |       2,494 m |         374 s |  EGP 22.47 | `الموقع داخل نطاق التوصيل الحالي ويمكن حساب السعر.`                                        |
| 5–6 km         | `31.440000, 31.780000` | Inside, `منطقة دمياط التجريبية` |       5,059 m |         759 s |  EGP 35.30 | `الموقع داخل نطاق التوصيل الحالي ويمكن حساب السعر.`                                        |
| Near zone edge | `31.305000, 31.705000` | Inside, `منطقة دمياط التجريبية` |      20,007 m |       3,001 s | EGP 110.04 | `الموقع داخل نطاق التوصيل الحالي ويمكن حساب السعر.`                                        |
| Outside zone   | `31.525000, 31.955000` | Outside                         | Not requested | Not requested |   Disabled | `الموقع خارج نطاق التوصيل الحالي. يمكنك تغيير الموقع أو طلب توسيع نطاق الخدمة من الإدارة.` |

Link verification:

| Link case                                                               | Result                                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Long: `https://www.google.com/maps/place/Damietta/@31.4321,31.8273,16z` | `COORDINATES_FOUND`; `31.4321, 31.8273`; inside the Damietta zone                                                                  |
| Real short: `https://maps.app.goo.gl/SUYnRhioQWb5eTAr8`                 | Safely followed to an allowlisted Google Maps place URL; `SHORT_LINK_REDIRECT`; `30.0711563, 31.011586`; outside the Damietta zone |
| No visible coordinates: `https://www.google.com/maps/place/Damietta`    | `MANUAL_SELECTION_REQUIRED`; null coordinates; original URL preserved; Arabic pin-placement guidance returned                      |

The Codex in-app browser rejected automated navigation to `localhost` under its
URL policy, so a human visual pass in that browser could not be recorded.
Interaction behavior was instead verified through reducer/projection/UI
regression tests, a successful production Next build, real HTTP calls, and live
PostGIS/quote results. A final human visual pass should still be performed in a
normal local browser.

## Tests and builds

- Focused final Vitest run: **9 files passed, 72 tests passed**.
- Phase 2 API/PostGIS/Redis integration suite: **5 tests passed** (included in
  the final 72).
- Map regression coverage includes distant pan, zoom-out selection, marker
  persistence, no auto-recenter, controls, and click projection.
- Eligibility coverage includes outside-point retention, quote disabled
  outside, quote enabled inside, and unchanged distant coordinates.
- Link coverage includes every long coordinate format, encoded query values,
  place/search/place-ID fallback, real resolver classifications, timeout,
  network failure, blocked redirect, unsafe IPs, excessive redirects, and Node
  single/all pinned DNS callback modes.
- Validation, API, and merchant TypeScript checks passed.
- Relevant ESLint checks passed.
- Prettier check passed for all changed implementation/test files.
- API `tsup` production build passed after the Node 24 resolver fix.
- Merchant Next.js production build passed.

The integration run emitted an existing `pg` deprecation warning about calling
`client.query()` while a query is executing; it did not fail a test and is not
caused by this location fix.

## Files changed

Configuration and documentation:

- `.env.example`
- `README.md`
- `docs/location-picker-navigation-and-links-fix-report.md`

Shared validation:

- `packages/validation/src/google-maps.ts`
- `packages/validation/src/google-maps.test.ts`
- `packages/validation/src/phase-two.ts`
- `packages/validation/src/phase-two.test.ts`
- `packages/validation/src/phase-four.ts`
- `packages/validation/src/phase-four.test.ts`

API:

- `apps/api/src/location/maps-link-resolver.ts`
- `apps/api/src/location/maps-link-resolver.test.ts`
- `apps/api/src/location/location.service.ts`
- `apps/api/src/location/location.controller.ts`
- `apps/api/src/phase-two.e2e.test.ts`

Merchant web:

- `apps/merchant-web/app/open-map.ts`
- `apps/merchant-web/app/open-map.test.ts`
- `apps/merchant-web/app/map-picker.tsx`
- `apps/merchant-web/app/map-picker.test.tsx`
- `apps/merchant-web/app/location-selection.ts`
- `apps/merchant-web/app/location-selection.test.ts`
- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/quote-input.test.ts`
- `apps/merchant-web/app/styles.css`

## Remaining limitations

- Text search is deliberately disabled until an approved geocoding provider and
  usage policy exist.
- OpenStreetMap raster tiles remain the visual basemap and require an
  appropriate production tile usage/deployment policy.
- Distance and duration remain deterministic offline estimates, not road,
  traffic, or turn-by-turn routes.
- Live short-link expansion depends on Google Maps network availability; safe
  timeouts and Arabic fallback messages are now explicit.
- Browser-policy restrictions prevented automated localhost visual inspection;
  a normal-browser human pass remains recommended.
