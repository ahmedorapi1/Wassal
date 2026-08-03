# WASSAL Location Picker Navigation and Google Maps Links Fix

Implement a focused fix for the WASSAL merchant customer-location experience.

The current location picker and Google Maps link flow have two usability problems:

1. Google Maps links frequently fail with a generic error.
2. The merchant map picker feels locked near the pickup/store location and does not allow comfortable selection of a farther customer location.

Do not remove service-zone validation. Improve the location-selection experience while keeping the backend authoritative.

## 1. Fix Google Maps Link Handling

Inspect the current implementation in:

- `apps/api/src/location/maps-link-resolver.ts`
- `apps/api/src/location/location.service.ts`
- `apps/merchant-web/app/map-picker.tsx`
- `apps/merchant-web/app/open-map.ts`
- `packages/validation/src/google-maps.ts`

Determine exactly why valid customer-shared Google Maps links fail.

Support the following safely:

- Long Google Maps URLs with explicit coordinates.
- `maps.app.goo.gl` short links.
- `google.com/maps/place/...` links.
- `google.com/maps/search/...` links.
- `?q=latitude,longitude`
- `?query=latitude,longitude`
- `/maps/@latitude,longitude`
- URLs containing `!3dlatitude!4dlongitude`
- Google Maps links whose final URL contains a place name or place identifier but no directly visible coordinates.

For links without directly extractable coordinates:

- Do not return only a generic failure.
- Return a structured result explaining that the link was valid but exact coordinates could not be extracted safely.
- Open the map picker and let the merchant manually place or adjust the pin.
- Preserve the original Google Maps URL as a reference.
- Show a clear Arabic message such as:
  `تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.`

Do not add a paid Google Maps, Geocoding, Places, or Directions API.

Keep existing SSRF and redirect security protections.

Improve user-facing error messages for:

- Unsupported link.
- Link contains no location.
- Short-link resolution timeout.
- Redirect blocked.
- Location outside service zone.
- Network failure.

Never show raw technical errors to the merchant.

## 2. Make the Map Freely Navigable

The merchant must be able to pan and zoom to any location.

Required behavior:

- Allow unrestricted map panning in all directions.
- Allow sufficient zoom out to view the full city and surrounding areas.
- Do not snap the map back to the store automatically after the user starts interacting.
- Do not constrain the marker to a small radius around the pickup point.
- Do not block selecting a point because it is far from the store.
- Allow clicking or tapping anywhere on the visible map to move the marker.
- Allow dragging the marker.
- Preserve marker position while zooming.
- Preserve marker position while panning.
- Support mouse, touch, and trackpad interaction.

The map may initially center on:

- The last confirmed customer location, or
- The pasted Google Maps location, or
- The merchant device location, or
- The store location as a final fallback.

Once the merchant moves the map or marker, do not auto-recenter unexpectedly.

## 3. Service-Zone Validation UX

Keep service-zone validation, but separate selection from eligibility.

The merchant must be allowed to select any point.

After selecting a point:

- Validate it against the active service zone.
- If inside:
  - Show a green confirmation.
  - Enable quote calculation.
- If outside:
  - Show the selected marker normally.
  - Show a clear warning:
    `الموقع خارج نطاق التوصيل الحالي. يمكنك تغيير الموقع أو طلب توسيع نطاق الخدمة من الإدارة.`
  - Disable quote calculation and order creation.
  - Do not move the marker automatically.
  - Do not reset the selected point.

The user must always understand whether the problem is:

- Map navigation.
- Invalid link.
- Missing coordinates.
- Network failure.
- Location outside service zone.

Do not combine these into a generic `Failed` message.

## 4. Add Useful Map Controls

Add clear RTL-friendly controls:

- `البحث عن منطقة أو شارع`
- `موقع المتجر`
- `موقعي الحالي`
- `موقع العميل المحدد`
- Zoom in.
- Zoom out.
- Reset view.
- Confirm location.
- Cancel.
- Clear location.

If zero-cost textual search cannot be implemented without using an unsuitable public geocoding service, keep the search field disabled behind a feature flag and document the limitation.

Do not silently call public Nominatim or another public geocoding service in production without an approved usage policy.

## 5. Better Google Link Flow

When the merchant pastes a Google Maps link:

1. Validate the URL.
2. Resolve approved short links safely.
3. Extract coordinates when possible.
4. Center the map on the extracted point.
5. Place the marker.
6. Require confirmation.
7. Validate the point against the service zone.
8. Invalidate any old quote.

If exact coordinates cannot be extracted:

1. Accept the valid Google Maps reference.
2. Open the freely navigable map.
3. Tell the merchant to place the pin manually.
4. Do not discard the pasted link.
5. Do not show a generic server error.

## 6. Distance and Quote Safety

When the confirmed marker changes:

- Clear the previous quote.
- Clear the previous distance, duration, and price.
- Update the authoritative latitude/longitude.
- Clear any conflicting saved-address ID.
- Require a new quote.
- Prevent order creation using the previous quote.

Do not weaken the existing quote fingerprint or immutable quote behavior.

## 7. Testing Requirements

Add tests for:

- Panning far away from the store.
- Zooming out and selecting a distant point.
- Marker persistence during pan and zoom.
- No unexpected auto-recentering.
- Selecting a point outside the service zone without resetting it.
- Quote disabled outside the service zone.
- Quote enabled inside the service zone.
- Valid long Google Maps URL.
- Valid short Google Maps URL.
- Valid Google link without directly extractable coordinates.
- Clear Arabic fallback instead of a generic error.
- Invalid link.
- Resolver timeout.
- Redirect blocked.
- Changing the confirmed marker invalidates the previous quote.
- The selected distant point reaches the quote API unchanged.

## 8. Manual Verification

Manually verify with at least:

- One point near the store.
- One point 5–6 km away.
- One point near the edge of the service zone.
- One point outside the service zone.
- One long Google Maps link.
- One short `maps.app.goo.gl` link.
- One Google Maps link without explicit coordinates.

Record:

- Selected coordinates.
- Service-zone result.
- Distance.
- Duration.
- Price.
- User-facing message.

## 9. Completion Report

Create:

`docs/location-picker-navigation-and-links-fix-report.md`

Include:

- Root cause of failed Google Maps links.
- Root cause of restricted map navigation.
- Files changed.
- Supported link formats.
- Fallback behavior for links without coordinates.
- Map navigation behavior.
- Service-zone UX.
- Tests added.
- Manual test results.
- Remaining limitations.
- Confirmation that no paid map or geocoding API was added.

Do not stop at analysis.

Implement the fix, run the relevant tests and builds, correct failures caused by this work, and produce the report.
