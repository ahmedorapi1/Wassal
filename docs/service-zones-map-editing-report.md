# WASSAL Service-Zone Map Editing Implementation Report

Date: 2026-07-29

## Outcome

Admin Web now manages service zones as map-selected center-and-radius coverage
areas. Raw north, south, east, and west inputs are no longer exposed.

The same service-zone record can be opened, mapped, edited, activated, and
deactivated. Radius and center changes preserve the zone ID and regenerate the
legacy PostGIS boundary automatically.

## Files changed

- `infrastructure/database/prisma/schema.prisma`
- `infrastructure/database/prisma/seed.ts`
- `infrastructure/database/prisma/migrations/20260729150000_service_zone_circles/migration.sql`
- `apps/api/src/admin/phase-two-admin.controller.ts`
- `apps/api/src/admin/phase-two-admin.service.ts`
- `apps/api/src/admin/service-zone-geometry.ts`
- `apps/api/src/admin/service-zone-geometry.test.ts`
- `apps/api/src/location/location.service.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/merchant/merchant.service.ts`
- `apps/api/src/service-zones.e2e.test.ts`
- `apps/api/src/merchant-registration.e2e.test.ts`
- `apps/admin-web/app/admin-app.tsx`
- `apps/admin-web/app/admin-app.test.tsx`
- `apps/admin-web/app/service-zone-map.tsx`
- `apps/admin-web/app/service-zone-map.test.tsx`
- `apps/admin-web/app/styles.css`
- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/styles.css`
- `docs/architecture/service-zones-pricing.md`
- `docs/service-zones-map-editing-report.md`

## API endpoints

No route names were added. The existing routes were extended:

- `GET /api/v1/admin/service-zones`
- `GET /api/v1/admin/service-zones/:zoneId`
- `POST /api/v1/admin/service-zones`
- `PATCH /api/v1/admin/service-zones/:zoneId`
- `POST /api/v1/admin/service-zones/:zoneId/activate`
- `POST /api/v1/admin/service-zones/:zoneId/deactivate`

Create and update now accept:

- `centerLatitude`
- `centerLongitude`
- `radiusKm`
- `maximumRouteDistanceMeters`

`PATCH` also accepts `status`, keeps optimistic `version` checking, and does not
apply create-time defaults to omitted fields.

Legacy GeoJSON create/update input remains accepted. The backend derives and
stores a compatible center and radius for that input.

## Database changes

Migration `20260729150000_service_zone_circles` adds:

- `ServiceZone.centerLatitude DECIMAL(9,6)`
- `ServiceZone.centerLongitude DECIMAL(9,6)`
- `ServiceZone.radiusKm DECIMAL(8,3)`
- latitude, longitude, and positive-radius constraints
- a partial unique index preventing exact duplicate active zones with the same
  lowercase name, center, and radius

Existing rows are backfilled from the polygon centroid and their existing
maximum route distance. Their compatibility boundary is then regenerated as a
circle.

All existing zone IDs, pricing references, quotes, orders, courier grants, and
historical relations are preserved.

## Geographic-distance and boundary method

Branch and delivery-point coverage uses PostGIS `ST_DWithin` with geography
types:

```text
distance(zone center, selected point) <= radiusKm * 1000
```

The compatibility `boundary` is generated with a geodesic PostGIS buffer:

```text
ST_Buffer(center::geography, radiusKm * 1000)
```

The API also returns automatic north/south/east/west informational bounds
calculated from latitude, longitude, radius, and latitude-adjusted longitude
scale. These bounds are never entered by an admin and are not authoritative
for eligibility.

The frontend utility includes a Haversine implementation for deterministic
unit verification and legacy-polygon conversion. PostGIS remains authoritative
at runtime.

## Radius versus route distance

The two limits remain separate:

- `radiusKm` controls straight-line geographic coverage.
- `maximumRouteDistanceMeters` controls the route returned by the maps
  provider.

Order quoting first finds an active circle covering pickup and drop-off, then
calculates the route, then rejects routes above the zone or pricing-rule route
limit.

For overlapping zones, order resolution skips active zones that do not have an
applicable active pricing rule. This prevents an unpriced overlap from
shadowing a valid priced zone. Branch coverage still uses every active
pickup-enabled circle.

## Existing branches after a radius reduction

Branches are never deleted or silently disabled.

Merchant store reads now return:

- `INSIDE_ACTIVE_ZONE`
- `OUTSIDE_ACTIVE_ZONES`
- `NO_LOCATION`

Merchant Web displays `خارج نطاق الخدمة الحالي` for a stored branch outside
all active pickup zones. New branch and new order validations use the updated
radius immediately.

## Activation, deactivation, and history

Admin Web displays Arabic confirmation dialogs for activation and
deactivation. Deactivation only changes the zone status and version.

It does not cancel or modify existing orders. Inactive zones are excluded from
new branch and order coverage checks.

Create, edit, activation, and deactivation use the immutable audit system.
Edit audit metadata records previous and next:

- center
- radius
- status
- maximum route distance

## Admin Web behavior

The responsive Arabic RTL zone list shows:

- name
- governorate and city
- active/inactive Arabic status
- radius
- maximum route distance
- last updated time
- map, edit, activate, and deactivate actions

The map uses OpenStreetMap tiles and supports:

- local city/district search and direct coordinate search
- clicking the map
- dragging the center marker
- panning and zooming
- current device location
- using the current map center
- a shaded live radius circle
- automatic viewport fitting
- read-only latitude, longitude, and radius
- restoring the existing center and circle when editing

## Verification results

- Migration deployment: passed.
- Deterministic seed: passed.
- Focused UI and geometry tests: 4 files, 15 tests passed.
- Service-zone API integration: 1 file, 2 tests passed.
- Phase 2 order/location regression: 1 file, 5 tests passed.
- Merchant registration/branch regression: 1 file, 2 tests passed.
- API TypeScript check: passed.
- Admin Web TypeScript check: passed.
- Merchant Web TypeScript check: passed.
- Targeted ESLint: passed with zero warnings.
- API production build: passed.
- Admin Web production build: passed.
- Merchant Web production build: passed.
- API health/readiness and both web roots: HTTP 200.
- Direct authenticated zone-list API check returned stored centers, radii, route
  limits, statuses, and update times correctly.

The in-app browser could not attach a webview during final UI automation.
No visual browser result is claimed. Component rendering, map math, API
integration, production builds, and live HTTP responses were verified.

## Manual testing steps

1. Open `http://localhost:3001`.
2. Sign in with `01001000005` / `AdminDemo123`.
3. Open `مناطق الخدمة`.
4. Confirm there are no north/south/east/west inputs.
5. Click `إضافة منطقة خدمة`.
6. Enter a unique name, `دمياط`, `دمياط الجديدة`, radius `25`, and a separate
   maximum route distance such as `30`.
7. Click `تحديد مركز المنطقة على الخريطة`.
8. Search for `دمياط الجديدة`, click or drag the marker, and confirm the
   shaded 25 km circle is completely visible.
9. Confirm the center and radius, then create the inactive zone.
10. Open `تعديل`, confirm the saved marker and circle are restored, change the
    radius to `35`, and save.
11. Confirm the same card/ID remains and no duplicate was created.
12. Use `عرض على الخريطة` to inspect the 35 km circle.
13. Activate the zone and confirm the Arabic dialog.
14. Create or validate a branch inside the circle and another outside it.
15. Reduce the radius and confirm an existing outside branch remains stored and
    shows `خارج نطاق الخدمة الحالي`.
16. Deactivate the zone and confirm new locations no longer use it.
17. Confirm an existing in-progress order did not change status.
18. Reactivate the same zone and confirm location validation uses it again.
19. Create a route whose two points are inside the circle but whose actual
    route exceeds the maximum route distance; confirm quote creation is
    rejected for the route limit.

No Git commit was created.
