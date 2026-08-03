# WASSAL UI and Location Fixes — Admin Readability, Customer Map Picker, Distance Recalculation, and Logo Alignment

Implement a focused corrective update for the current WASSAL MVP.

This is not a new large product phase. It is a targeted UI, location, pricing-calculation, and branding fix based on issues found during manual MVP testing.

Before modifying code, inspect:

- `docs/phase-4-implementation-report.md`
- Current merchant order-creation flow.
- Current customer-address and location components.
- Current quote and pricing APIs.
- Current admin order-list and order-detail pages.
- Current pricing-rule admin pages.
- Current application splash/login/landing components.
- Existing tests for address parsing, quotes, distance, pricing, and admin rendering.

Do not weaken existing Phase 3 or Phase 4 behavior.

Do not add:

- Live courier tracking.
- Background GPS.
- Paid maps APIs.
- Google Directions API.
- Payment gateways.
- SMS.
- WhatsApp.
- Customer accounts.
- Unrelated broad refactors.

The update must address four areas:

1. Fix stale or incorrect distance and price recalculation.
2. Add a merchant-friendly customer-location picker.
3. Replace raw JSON rendering in the admin frontend with readable UI.
4. Correct the logo alignment using the existing `logo.png` asset.

---

# 1. Fix the Distance and Pricing Recalculation Bug

## 1.1 Observed Problem

During manual testing, changing the customer delivery coordinates produced the same approximate distance and the same delivery price.

This suggests that one or more parts of the flow may be reusing stale data, such as:

- Previously saved customer coordinates.
- An old selected address.
- An old quote.
- Stale React form state.
- A cached quote response.
- Coordinates displayed in the UI but not included in the API request.
- The backend resolving a saved address instead of the newly selected temporary location.
- The quote confirmation using a quote created for older coordinates.

Do not assume the cause.

Trace the complete data path with evidence:

`Location selection`
→ `Merchant form state`
→ `Selected/saved address state`
→ `Quote request payload`
→ `API validation`
→ `Resolved pickup coordinates`
→ `Resolved delivery coordinates`
→ `Maps provider input`
→ `Distance calculation`
→ `Pricing calculation`
→ `Quote snapshot`
→ `Order confirmation`

## 1.2 Required Behavior

Whenever the merchant changes any location-relevant field, including:

- Latitude.
- Longitude.
- Maps URL.
- Selected saved address.
- Map pin.
- Current-location selection.
- Customer address selection.

The application must:

1. Update the authoritative form state.
2. Clear or invalidate the old quote.
3. Clear old price, distance, and duration results.
4. Require a new quote calculation.
5. Send the latest coordinates to the API.
6. Create a new immutable quote.
7. Prevent order creation from an old quote calculated for a different location.
8. Display the exact pickup and delivery coordinates used for that quote in the review step.
9. Display approximate distance, duration, and price from the new quote only.

The order-confirmation endpoint must continue requiring the exact quote ID and quote version.

## 1.3 Quote Staleness Protection

Add a client-side fingerprint for quote-relevant input.

The fingerprint should include at least:

- Pickup store ID.
- Delivery latitude.
- Delivery longitude.
- Selected customer/address identity.
- Package size.
- Weight.
- Fragile flag.
- Thermal-bag flag.
- Other fields that affect pricing.

When any fingerprint input changes:

- Mark the current quote stale.
- Disable the final create-order button.
- Require recalculation.

The backend remains authoritative.

Do not rely only on client protection.

## 1.4 Debug Visibility

In development mode only, make it easy to verify the calculation path.

The quote review may display:

- Pickup coordinates used.
- Delivery coordinates used.
- Calculated approximate distance.
- Calculated approximate duration.
- Pricing rule/version used.

Do not expose unnecessary technical fields to ordinary production users.

## 1.5 Required Tests

Add tests using at least three delivery locations from the same pickup store.

Assert:

- Each quote uses the submitted latest coordinates.
- Different coordinates produce different calculated distances.
- A sufficiently distant location produces a higher price under the current pricing rule.
- Changing coordinates invalidates the old quote in the frontend.
- Order creation is blocked until a fresh quote is calculated.
- A quote created for location A cannot be silently reused after changing to location B.
- Saved-address selection and temporary-map selection do not overwrite each other incorrectly.
- The immutable order snapshot matches the selected quote location.

Use deterministic coordinates and exact expected results from the existing local maps provider.

Do not introduce a paid routing provider.

---

# 2. Customer Location Selection for Merchants

## 2.1 Goal

The merchant must not be expected to understand or manually obtain latitude and longitude.

Latitude and longitude should still be stored internally, but ordinary users should select the customer location through a visual location experience.

## 2.2 Required Location Section

In the merchant customer/address or new-order screen, create a clear section titled:

`Customer Location`

or the appropriate Arabic-first RTL equivalent.

Display the following actions:

- `Select Location on Map`
- `Use My Current Location`
- `Paste Google Maps Link`
- `Advanced: Enter Coordinates Manually`

The advanced latitude/longitude fields should be collapsed or visually secondary.

## 2.3 Select Location on Map

Add a map-picker dialog, modal, or dedicated step.

Behavior:

1. Open centered on:
   - The store city/service zone, or
   - The last selected point, if one exists.
2. Allow the merchant to:
   - Click/tap on the map.
   - Move a marker.
   - Adjust the marker before confirmation.
3. Display the selected point.
4. Display safe address/area information when available without requiring a paid geocoder.
5. Provide:
   - `Confirm Location`
   - `Cancel`
   - `Reset`
6. After confirmation:
   - Store latitude and longitude in form state.
   - Mark the source as `MAP_PICKER`.
   - Invalidate any previous quote.
   - Display a confirmed-location summary.
7. Do not track the merchant after the point is confirmed.

## 2.4 Zero-Cost Map Policy

Use a zero-cost/open map approach suitable for the controlled MVP pilot.

A library such as Leaflet/OpenStreetMap may be used if compatible with the existing architecture.

Requirements:

- Follow the map tile provider’s attribution requirements.
- Include visible attribution.
- Do not add Google Maps JavaScript API.
- Do not add paid routing.
- Do not add courier tracking.
- Do not continuously upload device location.
- Isolate the tile-provider configuration so it can be replaced later.
- Document that public community tile servers may not be appropriate for large production traffic.

Do not block the whole update if a zero-cost map picker requires a small isolated dependency.

Avoid unnecessary mapping libraries.

## 2.5 Use My Current Location

Add a button:

`Use My Current Location`

This means the current browser/device location of the merchant user.

Requirements:

- Ask for browser geolocation permission only after the button is pressed.
- Do not ask automatically on page load.
- Use one-time location retrieval.
- Do not watch location continuously.
- Do not store movement history.
- Display a clear explanation that this is useful only if the device is currently at the customer delivery location.
- Show errors for:
  - Permission denied.
  - Location unavailable.
  - Timeout.
  - Coordinates outside supported service zones.
- Require merchant confirmation after retrieval.
- Mark location source as `DEVICE_LOCATION`.
- Invalidate the previous quote.

Do not add courier GPS or background location.

## 2.6 Paste Google Maps Link

The customer may send a Google Maps location link to the merchant through any external communication method.

The merchant should paste it into:

`Paste Google Maps Link`

Support:

- Long Google Maps URLs containing explicit coordinates.
- Supported `google.com/maps` URLs.
- Common short links such as `maps.app.goo.gl` when they can be safely resolved.

### Safe Short-Link Resolution

If short-link resolution is implemented server-side:

- Allowlist only approved Google Maps hostnames.
- Use HTTPS only.
- Limit redirects.
- Reject redirects to non-allowlisted domains.
- Use strict timeout.
- Restrict response size.
- Do not fetch private-network, loopback, link-local, metadata, or local addresses.
- Resolve DNS safely.
- Prevent SSRF.
- Do not execute page scripts.
- Extract only the final safe location URL or explicit coordinates.
- Return a clear error when coordinates cannot be safely extracted.
- Add rate limiting.
- Do not call a paid geocoding API.

After extraction:

1. Show the selected point on the map.
2. Show extracted coordinates internally or in advanced details.
3. Require merchant confirmation.
4. Store the original safe source URL where appropriate.
5. Mark source as `GOOGLE_MAPS_LINK`.
6. Invalidate the previous quote.

## 2.7 Selected Location Summary

After selection, show:

- `Location selected`
- Area/service zone.
- Approximate textual address if already available.
- Map preview or static marker.
- `Open in Google Maps`
- `Change Location`
- `Clear Location`

Do not show raw latitude/longitude prominently.

They may be visible under advanced details.

## 2.8 Review Before Quote and Order

Before calculating the quote, ensure a confirmed delivery point exists.

Before creating the order, the existing Phase 4 review page must show:

- Customer.
- Phone.
- Textual address.
- Selected location.
- Location-source type.
- External preview link.
- Pickup point.
- Delivery point.
- Approximate distance.
- Approximate duration.
- Full price breakdown.
- Warning that the merchant must confirm location accuracy.

---

# 3. Replace Raw JSON in the Admin Frontend

## 3.1 Observed Problem

The admin frontend currently displays raw JSON in:

- Order list or order rows.
- Order detail.
- Customer and delivery information.
- Address snapshots.
- Package snapshots.
- Pricing information.
- Pricing-rule details.
- Event metadata.
- Audit metadata.
- Potentially dispute, return, and finance metadata.

Raw JSON is not acceptable as the normal frontend experience.

It may remain available only as a restricted technical-debug view.

## 3.2 General UI Rule

No ordinary admin screen should render objects using:

- `JSON.stringify(...)`
- Raw `<pre>` blocks.
- Unformatted object dumps.
- Unlabeled key/value technical metadata.

Replace raw JSON with:

- Cards.
- Labeled fields.
- Tables.
- Status badges.
- Timelines.
- Currency formatting.
- Date/time formatting.
- Address formatting.
- Human-readable Arabic/English labels.
- Empty-state text.
- Collapsible sections where appropriate.

## 3.3 Admin Orders List

The admin order list must use readable columns/cards such as:

- Order number.
- Created date/time.
- Merchant.
- Store.
- Customer.
- Pickup area.
- Delivery area.
- Approximate distance.
- Delivery fee.
- Courier.
- Status.
- Dispute indicator.
- Return indicator.
- Settlement/accounting indicator where authorized.
- Open details action.

Do not display full JSON snapshots in the list.

Use pagination and existing filters.

## 3.4 Admin Order Detail

Organize the page into clearly labeled sections.

### A. Order Summary

Display:

- Order number.
- Status badge.
- Created time.
- Last updated time.
- Merchant.
- Store.
- Assigned courier.
- Service zone.
- Current version.
- Completion/dispute state.

### B. Customer Information

Display:

- Customer name.
- Phone.
- Governorate.
- City.
- Area.
- Street.
- Building.
- Floor.
- Apartment.
- Landmark.
- Delivery notes.

Hide empty optional fields cleanly rather than showing `null`.

### C. Pickup Information

Display:

- Store name.
- Store address.
- Area/service zone.
- Coordinates in advanced details.
- `Open Pickup Location` button.

### D. Delivery Information

Display:

- Full delivery address.
- Area/service zone.
- Customer notes.
- Location source.
- `Open Customer Location` button.
- Coordinates only under advanced details.

### E. Package Information

Display:

- Description.
- Package size.
- Weight.
- Item count.
- Declared value.
- Fragile.
- Thermal bag.
- Other relevant package flags.

Use readable yes/no badges.

### F. Route Information

Display:

- Approximate distance in kilometers.
- Approximate duration.
- Pricing estimate disclaimer.
- Pickup and delivery point summary.

### G. Pricing Breakdown

Do not render the pricing snapshot JSON.

Display human-readable fields:

- Base fee.
- Included distance.
- Extra distance.
- Distance charge.
- Package-size surcharge.
- Weight surcharge.
- Fragile surcharge.
- Thermal-bag surcharge.
- Waiting or return charge if applicable.
- Discount.
- Tax.
- Delivery total.
- Platform commission percentage.
- Platform commission amount.
- Estimated courier net.
- Currency.
- Pricing rule version.

Format money as EGP.

Example:

- `Base fee: EGP 15.00`
- `Platform commission: 20%`
- `Platform commission amount: EGP 8.00`
- `Courier net: EGP 32.00`

Only authorized finance/super-admin roles should see courier financial values.

Operations/support users should see only the financial fields permitted by RBAC.

### H. Order Timeline

Convert events into a readable chronological timeline:

- Created.
- Quote confirmed.
- Searching for courier.
- Courier accepted.
- Arriving at pickup.
- Arrived at pickup.
- Picked up.
- In transit.
- Arrived at drop-off.
- Delivered.
- Disputed.
- Returned.
- Completed.
- Cancelled.

Each timeline item should show:

- Human-readable event label.
- Date/time.
- Actor.
- Optional reason.
- Optional note.
- Status transition.

Do not expose raw event metadata by default.

### I. Delivery Dispute

Display:

- Dispute status.
- Merchant reason.
- Merchant note.
- Courier response.
- Admin resolution.
- Actors.
- Timestamps.

Use readable labels and cards.

### J. Return Information

Display:

- Failure reason.
- Courier note.
- Return started time.
- Return arrival time.
- Merchant confirmation.
- Return condition.
- Admin override if present.

### K. Audit History

Display:

- Action.
- Actor.
- Date/time.
- Target.
- Human-readable summary.

Do not display raw audit metadata by default.

## 3.5 Pricing Admin Page

Replace pricing-rule JSON with a readable form and detail view.

Display:

- Rule name.
- Scope.
- City.
- Service zone.
- Vehicle type.
- Version.
- Status.
- Effective dates.
- Priority.
- Base fee.
- Included kilometers.
- Fee per kilometer.
- Minimum fee.
- Package surcharges.
- Weight bands.
- Fragile surcharge.
- Thermal-bag surcharge.
- Commission percentage.
- Tax.
- Waiting fee.
- Return-trip setting.
- Created by.
- Created at.

Create/edit/version UI must use labeled fields rather than JSON input.

If some advanced configuration still requires structured data:

- Build dedicated repeatable form rows.
- Validate each row.
- Do not ask normal administrators to edit JSON manually.

## 3.6 Finance and Payment-Proof UI

Ensure the same rule is applied to:

- Settlement lines.
- Ledger entries.
- External payments.
- Payment-proof review.
- Adjustments.
- Waivers.
- Reversals.

Display labeled values and tables.

No raw JSON in the main UI.

## 3.7 Technical JSON View

A restricted optional technical view may remain.

Requirements:

- Hidden by default.
- Clearly labeled `Technical Data`.
- Available only in development or to `super_admin`.
- Collapsible.
- Never the primary display.
- Redact secrets, tokens, private file URLs, and unnecessary personal data.
- Pretty-print only after redaction.

Search the frontend for all raw `JSON.stringify` and `<pre>` usages and classify each:

- Replace with readable UI.
- Keep only as restricted technical data.
- Remove entirely.

## 3.8 UI Quality Requirements

- Arabic-first RTL.
- English localization preserved.
- Responsive layouts.
- Proper empty states.
- Proper loading states.
- Error states.
- Accessible labels.
- Copy buttons for order number and phone where appropriate.
- Consistent badges.
- Consistent EGP formatting.
- Consistent `Africa/Cairo` date/time formatting.

---

# 4. Logo Alignment and Splash/Login Branding

## 4.1 Existing Asset

A file named:

`logo.png`

has been added to the repository.

Locate the actual file rather than creating a duplicate asset.

Inspect:

- Image dimensions.
- Transparent padding.
- Existing usage.
- Splash/login/landing component.
- CSS or React Native styles.
- Asset configuration.

Use the existing `logo.png`.

Do not regenerate or redesign the logo.

## 4.2 Observed Problem

On the opening page, the logo appears shifted to one side and the central `W` mark is not visually centered inside the logo container.

The desired result is:

- Logo container centered horizontally.
- Logo centered vertically inside its container.
- The visible `W` symbol visually centered.
- No left/right clipping.
- No stretching.
- No unexpected cropping.
- Correct appearance in RTL and LTR.
- Correct appearance on different screen widths.

## 4.3 Required Fix

Determine whether the problem is caused by:

- Container alignment.
- Flexbox styles.
- RTL direction.
- `object-position`.
- `resizeMode`.
- Incorrect width/height.
- `position: absolute`.
- Parent padding.
- Image transparent whitespace.
- The image itself containing asymmetric transparent padding.

Apply the smallest correct fix.

For web:

- Use a centered flex/grid container.
- Use `object-fit: contain`.
- Use centered `object-position`.
- Preserve aspect ratio.
- Avoid directional margins such as `margin-left` for centering.
- Ensure RTL does not shift the image.

For React Native/Expo:

- Use `alignItems: 'center'`.
- Use `justifyContent: 'center'` where appropriate.
- Use `resizeMode: 'contain'`.
- Avoid `left` offsets.
- Preserve dimensions responsively.

If `logo.png` contains excessive or asymmetric transparent padding:

- Do not alter the original silently.
- Prefer CSS/layout correction first.
- If asset cropping is genuinely necessary, create an optimized derived application asset while preserving the original.
- Document the derived asset.
- Do not change the logo design.

## 4.4 Screens to Check

Inspect every surface that uses the logo:

- Merchant login/opening page.
- Admin login/opening page.
- Courier splash/login/onboarding.
- Navigation header if applicable.
- Legal/public pages if applicable.

Make the visual presentation consistent.

## 4.5 Logo Tests

Add reasonable tests or visual assertions for:

- Logo asset loads.
- Correct `alt`/accessibility label.
- Centering classes/styles are applied.
- RTL does not apply a directional offset.
- Image uses contain/preserved aspect ratio.
- No broken path in production builds.

A screenshot-based test is optional if the repository already supports it.

---

# 5. API and Security Requirements for Maps Links

If implementing short Google Maps link resolution, add a narrowly scoped endpoint such as:

`POST /api/v1/location/resolve-maps-link`

or integrate it safely into the existing address API.

Input:

- Google Maps URL only.

Output:

- Normalized safe URL.
- Latitude.
- Longitude.
- Extraction source/pattern.
- Service-zone validation result.

Security requirements:

- Authenticated merchant user only.
- Rate limited.
- Strict URL schema.
- HTTPS only.
- Google Maps hostname allowlist.
- Maximum URL length.
- Maximum redirects.
- Redirect-domain allowlist.
- DNS/private-network SSRF protection.
- Timeout.
- Response-size limit.
- No arbitrary HTML forwarding.
- No JavaScript execution.
- No open proxy behavior.
- Audit only when useful; do not store unnecessary browsing data.

Add security tests for:

- Loopback URLs.
- Private IPs.
- Cloud metadata addresses.
- Redirect to non-Google domain.
- Excessive redirects.
- Unsupported domains.
- Malformed links.
- Valid long link.
- Valid supported short link.
- Link with no coordinates.

---

# 6. Required Verification

Run:

- Formatting.
- Linting.
- Type checking.
- Unit tests.
- Database integration tests.
- Relevant E2E tests.
- Merchant production build.
- Admin production build.
- Courier build/export if shared logo or components change.
- API build if location-link resolution changes.
- Prisma validation if schema changes.
- Migration tests if any schema change is required.

Manually verify:

1. Select location A and calculate quote.
2. Change to location B.
3. Old quote becomes invalid.
4. New distance and price are different.
5. Create order using location B.
6. Admin order detail shows readable sections.
7. No primary admin screen displays raw JSON.
8. Pricing rule page is readable.
9. Customer and delivery locations open correctly.
10. Logo is visually centered on all affected opening/login pages.
11. RTL does not move the logo.
12. No live tracking was added.
13. No paid maps API was added.

---

# 7. Required Completion Report

After implementation, create:

`docs/location-admin-ui-logo-fix-report.md`

Include:

1. Root cause of the stale distance/price issue.
2. Exact files changed.
3. Old versus new quote behavior.
4. Location picker implementation.
5. Current-location behavior.
6. Google Maps link formats supported.
7. Short-link security design.
8. Admin JSON usages found.
9. Admin JSON usages replaced.
10. Any restricted technical JSON view retained.
11. Admin order-detail redesign.
12. Pricing UI redesign.
13. Logo root cause.
14. Logo asset path.
15. Logo style/layout changes.
16. Tests added.
17. Verification results.
18. Remaining limitations.
19. Updated MVP readiness percentage.

Print a terminal summary containing:

- Distance-calculation bug root cause.
- Three-location test results.
- Example distances and prices.
- Number of raw JSON views replaced.
- Supported location-selection methods.
- Logo path used.
- Confirmation that the logo is centered.
- Test/build results.
- Confirmation that no paid maps API was added.
- Exact report path.

Do not stop after analysis or planning.

Implement the fixes, run the verification suite, correct failures caused by this work, and produce the completion report.
